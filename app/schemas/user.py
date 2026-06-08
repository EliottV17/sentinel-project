import re
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserBase(BaseModel):
    name: str
    last_name: str
    username: str = Field(..., min_length=3, max_length=20)
    email: EmailStr
    phonenumber: str | None = None

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, value):
        if not value.isalnum():
            raise ValueError("Username must be alphanumeric")
        return value


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)

    @field_validator("password")
    @classmethod
    def password_complexity(cls, value):
        if not re.search(r"[A-Za-z]", value) or not re.search(r"[0-9]", value):
            raise ValueError("Password must contain both letters and numbers")
        return value


class UserRead(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    status: str

    model_config = {"from_attributes": True}

    model_config = {"from_attributes": True}
