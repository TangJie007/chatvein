# mcp-ip（ip2region 离线归属地）

## 选型

用官方绑定 `py-ip2region`（Apache-2.0），不做在线 GeoIP API：桌面端可离线、无 QPS
限额、对中国 IP 划分更细。xdb 不随包装（约十余 MB），首次查询下载到
`CHATVEIN_DATA_DIR/ip2region/`，与 embeddings 权重策略一致。

## 工具

- `get_my_location`：公网 echo（ipify 等）拿出口 IP → 本地查库
- `lookup_ip_region`：给定 IPv4/IPv6；私有/回环不查库

## 覆盖路径

`CHATVEIN_IP2REGION_V4` / `CHATVEIN_IP2REGION_V6` 指向本地 xdb 可跳过下载。
