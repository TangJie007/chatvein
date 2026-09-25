"""chats.entity：群组表 + 记录类型。"""

from .dto import ChatGroupRecord, GroupMembersDto
from .entity import ChatGroup

__all__ = ["ChatGroup", "ChatGroupRecord", "GroupMembersDto"]
