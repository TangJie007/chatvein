"""conversations.entity：会话与消息表 + 记录类型。"""

from .dto import ConversationRecord, CreateConversationDto, MessageRecord, Role
from .entity import Conversation, Message

__all__ = [
    "Conversation",
    "Message",
    "ConversationRecord",
    "MessageRecord",
    "CreateConversationDto",
    "Role",
]
