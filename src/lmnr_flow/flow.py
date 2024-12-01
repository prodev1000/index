import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from queue import Queue
from threading import Lock
from typing import Any, Callable, Dict, List, Optional, Union

from lmnr import Laminar, observe

from .context import Context
from .state import State

__ERROR__ = "__ERROR__"
__OUTPUT__ = "__OUTPUT__"


@dataclass
class TaskOutput:
    output: Any
    next: Union[List[str], None]


@dataclass
class Task:
    id: str
    action: Callable[[Context], TaskOutput]


class Flow:
    def __init__(
        self,
        thread_pool_executor: ThreadPoolExecutor,
        context: Optional[Context] = None,
    ):
        self.tasks = {}  # str -> Task
        self.active_tasks = set()  # Set of str
        self.context = context or Context()  # Global context
        self.output_task_ids = set()  # Set of str
        self._executor = thread_pool_executor

        # Thread-safety locks
        self.active_tasks_lock = Lock()
        self.output_ids_lock = Lock()
        self.logger = logging.getLogger(__name__)

    def add_task(self, name: str, action: Callable[[Context], TaskOutput]):
        self.context.set_state(name, State.empty())
        self.tasks[name] = Task(name, action)
        self.logger.info(f"Added task '{name}'")

    def execute_task(
        self, task: Task, task_queue: Queue, stream_queue: Optional[Queue] = None
    ):
        self.logger.info(f"Starting execution of task '{task.id}'")

        try:
            with Laminar.start_as_current_span(task.id, input=self.context.to_dict()):
                result: TaskOutput = task.action(self.context)
                Laminar.set_span_output(result)

            # Set state to the output of the task
            self.context.set(task.id, result.output)

            # Push to stream queue if it exists
            if stream_queue is not None:
                stream_queue.put((task.id, result.output))

            # If no next tasks specified, this is an output node
            if not result.next or len(result.next) == 0:
                self.logger.info(f"Task '{task.id}' completed as output node")
                with self.output_ids_lock:
                    self.output_task_ids.add(task.id)
                    task_queue.put(__OUTPUT__)
            else:
                self.logger.debug(
                    f"Task '{task.id}' scheduling next tasks: {result.next}"
                )

                with self.active_tasks_lock:
                    for next_task_id in result.next:
                        if next_task_id in self.tasks:
                            if next_task_id not in self.active_tasks:
                                task_queue.put(next_task_id)
                        else:
                            raise Exception(f"Task {next_task_id} not found")

        except Exception as e:
            self.context.set(
                __ERROR__, {"error": str(e), "traceback": traceback.format_exc()}
            )
            with self.active_tasks_lock:
                self.active_tasks.clear()

            task_queue.put(__ERROR__)

            raise e

        finally:
            self.logger.info(f"Completed execution of task '{task.id}'")
            with self.active_tasks_lock:
                self.active_tasks.remove(task.id)

    @observe(name="flow.run")
    def run(
        self, start_task_id: str, inputs: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        self.logger.info(f"Starting engine run with initial task: {start_task_id}")
        # thread-safe queue of task ids
        task_queue = Queue()
        futures = set()

        task_queue.put(start_task_id)

        if inputs:
            for key, value in inputs.items():
                self.context.set(key, value)

        # Main execution loop
        while True:
            # block until there is a task to spawn
            task_id = task_queue.get()

            if task_id == __ERROR__:
                # Cancel all pending futures on error
                for f in futures:
                    f.cancel()

                err = self.context.get(__ERROR__)
                raise Exception(err)

            if task_id == __OUTPUT__:
                with self.active_tasks_lock:
                    if len(self.active_tasks) == 0:
                        break
                continue

            with self.active_tasks_lock:
                self.active_tasks.add(task_id)

            task = self.tasks[task_id]
            future = self._executor.submit(self.execute_task, task, task_queue)
            futures.add(future)

        # Return values of the output nodes
        # task_id -> value of the task
        return {task_id: self.context.get(task_id) for task_id in self.output_task_ids}

    @observe(name="flow.stream")
    def stream(self, start_task_id: str):
        print("stream")
        task_queue = Queue()
        stream_queue = Queue()
        futures = set()

        self.context.set_stream(stream_queue)

        def run_engine():
            task_queue.put(start_task_id)
            while True:
                task_id = task_queue.get()

                if task_id == __ERROR__:
                    for f in futures:
                        f.cancel()
                    stream_queue.put((None, None))  # Signal completion
                    break

                if task_id == __OUTPUT__:
                    with self.active_tasks_lock:
                        if len(self.active_tasks) == 0:
                            stream_queue.put((None, None))  # Signal completion
                            break
                    continue

                task = self.tasks[task_id]

                with self.active_tasks_lock:
                    self.active_tasks.add(task_id)

                future = self._executor.submit(
                    self.execute_task, task, task_queue, stream_queue
                )
                futures.add(future)

        self._executor.submit(run_engine)

        # Yield results from stream queue
        while True:
            task_id, output = stream_queue.get()
            if task_id is None:  # Check for completion signal
                break
            yield task_id, output

    def get_context(self) -> Context:
        return self.context
