from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel

from index.llm.llm import Message, ThinkingBlock


class AgentState(BaseModel):
	"""State of the agent"""

	messages: list[Message]

class ActionResult(BaseModel):
	"""Result of executing an action"""

	is_done: Optional[bool] = False
	content: Optional[str] = None
	error: Optional[str] = None
	give_control: Optional[bool] = False

class ActionModel(BaseModel):
	"""Model for an action"""

	name: str
	params: Dict[str, Any]

class AgentLLMOutput(BaseModel):
	"""Output model for agent"""

	thought: str
	action: ActionModel
	summary: Optional[str] = None
	thinking_block: Optional[ThinkingBlock] = None

class AgentOutput(BaseModel):
	"""Output model for agent"""

	agent_state: AgentState
	result: ActionResult
	step_count: int = 0
	cookies: Optional[list[dict[str, Any]]] = None
	trace_id: str | None = None


class AgentStreamChunk(BaseModel):
	"""Base class for chunks in the agent stream"""
	type: str

class StepChunkContent(BaseModel):
	action_result: ActionResult
	summary: str
	trace_id: str | None = None

class StepChunk(AgentStreamChunk):
	"""Chunk containing a step result"""
	type: Literal["step"] = "step"
	content: StepChunkContent

class TimeoutChunkContent(BaseModel):
	action_result: ActionResult
	summary: str
	step: int
	agent_state: AgentState
	step_parent_span_context: Optional[str]
	trace_id: str | None = None

class TimeoutChunk(AgentStreamChunk):
	"""Chunk containing a timeout"""
	type: Literal["step_timeout"] = "step_timeout"
	content: TimeoutChunkContent

class StepChunkError(AgentStreamChunk):
	"""Chunk containing an error"""
	type: Literal["step_error"] = "step_error"
	content: str

class FinalOutputChunk(AgentStreamChunk):
	"""Chunk containing the final output"""
	type: Literal["final_output"] = "final_output"
	content: AgentOutput
