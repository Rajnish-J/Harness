from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=100_000)


class ResetRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
