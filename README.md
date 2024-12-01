# Laminar Flow

A lightweight task engine for building AI agents that prioritizes simplicity and flexibility.

## Core Concept

Unlike traditional node-based workflows, Laminar Flow uses a dynamic task queue system built on three simple principles:

1. **Concurrent Execution** - Tasks run in parallel automatically
2. **Dynamic Scheduling** - Tasks can schedule new tasks at runtime
3. **Smart Dependencies** - Tasks can await results from previous operations

Results of all tasks are stored in a thread-safe `Context`.

This task-based architecture makes complex workflows surprisingly simple:

✨ **What's Possible:**
[x] Parallel task execution without explicit threading code
[x] Self-modifying dynamic workflows and cycles
[x] Conditional branching and control flow
[x] Streaming of tasks execution
[x] Automatic state management and persistence

Flow is extremely lightweight, clearly written and has not external dependencies for the engine. It is designed and maintained by [Laminar](https://github.com/lmnr-ai) team.

## Auto-instrumentation
Flow comes with auto-instrumentation for tracing using [Laminar](https://github.com/lmnr-ai/lmnr). To enable tracing, initialize the Laminar SDK with tracing enabled before using Flow.

```python
from lmnr import Laminar
Laminar.initialize(project_api_key="...")
```

> Tracing is extremely useful for debugging and state reconstruction. When tracing is enabled, Flow will automatically capture the state at each step. During debugging, you can load the captured state and inspect the context. To learn more about tracing, see the [Laminar docs](https://docs.lmnr.ai).

## Getting started

### Basic Usage
```python
from concurrent.futures import ThreadPoolExecutor
from lmnr_flow import Flow, TaskOutput

# thread pool executor is optional, defaults to 4 workers
flow = Flow(thread_pool_executor=ThreadPoolExecutor(max_workers=4))

# Simple task that returns a result
def my_task(context: Context) -> TaskOutput:
    return TaskOutput(output="Hello World!", next=None)

flow.add_task("greet", my_task)
result = flow.run("greet")  # Returns {"greet": "Hello World!"}
```

### Task Chaining
```python
# Tasks can trigger other tasks
def task1(context: Context) -> TaskOutput:
    return TaskOutput(output="result1", next=["task2"])

def task2(context: Context) -> TaskOutput:
    # Access results from previous tasks
    t1_result = context.get("task1")  # waits for task1 to complete
    return TaskOutput(output="result2", next=None)

flow.add_task("task1", task1)
flow.add_task("task2", task2)
flow.run("task1")  # Returns {"task2": "result2"}
```

### Parallel Execution
```python
def starter(context: Context) -> TaskOutput:
    # Launch multiple tasks in parallel
    return TaskOutput(output="started", next=["slow_task1", "slow_task2"])

def slow_task1(context: Context) -> TaskOutput:
    time.sleep(1)
    return TaskOutput(output="result1", next=None)

def slow_task2(context: Context) -> TaskOutput:
    time.sleep(1)
    return TaskOutput(output="result2", next=None)

# Both slow_tasks execute in parallel, taking ~1 second total
flow.add_task("starter", starter)
flow.add_task("slow_task1", slow_task1)
flow.add_task("slow_task2", slow_task2)
flow.run("starter")
```

### Streaming Results
```python
def streaming_task(context: Context) -> TaskOutput:
    # Stream intermediate results
    stream = context.get_stream()
    for i in range(3):
        stream.put(("streaming_task", f"interim_{i}"))
    return TaskOutput(output="final", next=None)

flow.add_task("streaming_task", streaming_task)

# Get results as they arrive
for task_id, output in flow.stream("streaming_task"):
    print(f"{task_id}: {output}")
    # Prints:
    # streaming_task: interim_0
    # streaming_task: interim_1
    # streaming_task: interim_2
    # streaming_task: final
```

### Dynamic Workflows
```python
def conditional_task(context: Context) -> TaskOutput:
    count = context.get("count", 0)
    
    if count >= 3:
        return TaskOutput(output="done", next=["finish"])
    
    context.set("count", count + 1)
    return TaskOutput(output=f"iteration_{count}", next=["conditional_task"])

# Task will loop 3 times before finishing
flow.add_task("conditional_task", conditional_task)
flow.add_task("finish", lambda ctx: TaskOutput("completed", None))
flow.run("conditional_task")
```

### Input Parameters
```python
def parameterized_task(context: Context) -> TaskOutput:
    name = context.get("user_name")
    return TaskOutput(output=f"Hello {name}!", next=None)

flow.add_task("greet", parameterized_task)
result = flow.run("greet", inputs={"user_name": "Alice"})
# Returns {"greet": "Hello Alice!"}
```

### Dynamic Routing
```python
def router(context: Context) -> TaskOutput:
    task_type = context.get("type")
    routes = {
        "process": ["process_task"],
        "analyze": ["analyze_task"],
        "report": ["report_task"]
    }
    return TaskOutput(output=f"routing to {task_type}", next=routes.get(task_type, []))

def process_task(context: Context) -> TaskOutput:
    return TaskOutput(output="processed data", next=None)

flow.add_task("router", router)
flow.add_task("process_task", process_task)
result = flow.run("router", inputs={"type": "process"})
# Returns {"process_task": "processed data"}
```

## State Management

```python
context = Context()
context.from_dict({"task1": "result1"})

flow = Flow(context=context)
flow.add_task("task2", lambda ctx: TaskOutput("result2", None))
flow.run("task2")

assert flow.context.get("task1") == "result1" # True, because it was set in the context
assert flow.context.get("task2") == "result2"
```

## Advanced Features

- **Context Sharing**: All tasks share the same context, allowing for complex data flows
- **Error Handling**: Exceptions in tasks are properly propagated
- **Thread Safety**: All operations are thread-safe
- **Minimal Dependencies**: Core engine has zero external dependencies

## Roadmap
[ ] Add async support
[ ] Serverless deployment

