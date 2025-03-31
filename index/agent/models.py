from __future__ import annotations

from typing import Any, Dict, Optional

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
	cookies: Optional[list[dict[str, Any]]] = None