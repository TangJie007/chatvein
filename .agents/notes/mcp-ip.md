# mcp-ip（免费归属地降级）

## 选型

在线免费源，**均不使用 API Key**：

1. **ipinfo.io**（`https://ipinfo.io/.../json`）
2. **ipwhois.io**（官方客户端 `ipwhois-python`，无 key）
3. **ip-api.com**（免费档 HTTP `ip-api.com/json`）

任一成功即返回（结果带 `provider` 字段）；全部超时/失败则工具返回
`定位失败: 全部免费源均失败（ipinfo: …；ipwhois: …；ip-api: …）`。

## 工具

- `get_my_location` → 链路上无参自探测出口 IP
- `lookup_ip_region` → 查给定 IP；私有/回环本地拦截，不打网
