"""conversations.entity：会话表 + 记录类型（消息记录来自会话空间库）。"""

from .dto import ConversationRecord, CreateConversationDto, MessageRecord, Role
from .entity import Conversation

__all__ = [
    "Conversation",
    "ConversationRecord",
    "MessageRecord",
    "CreateConversationDto",
    "Role",
]
