import type { StructuredToolInterface } from '@langchain/core/tools'

/**
 * MCP 工具描述覆盖（向量化 + 模型侧短描述）。
 *
 * 在 `loadMcpTools` 后就地改写 description，不 fork 上游包。
 * key 优先用裸工具名；**跨 server 同名**必须用 `{server}__{tool}`（见 list_allowed_directories、
 * run_workspace_script 等）。`resolveMcpDescriptionOverride` 先匹配全名再剥前缀。
 */

export const MCP_FILESYSTEM_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  read_file:
    '已弃用：请改用 read_text_file。读取单个文本文件全文。deprecated alias for reading a text file.',
  read_text_file:
    '读取单个文本文件内容；可 head/tail 截取行。查看源码、配置、日志、说明。read text file, cat, view source, open file contents.',
  read_media_file:
    '读取图片或音频等媒体文件，返回 base64 与 MIME。看图、听音频、嵌入资源。read image audio media binary as base64.',
  read_multiple_files:
    '一次并行读取多个文本文件，便于对比或批量分析。batch read many files, compare sources.',
  write_file:
    '新建或整文件覆盖写入文本。创建/保存/覆盖文件内容。write create overwrite save file.',
  edit_file:
    '按精确文本片段做局部替换，返回 git diff；可 dryRun 预览。修改代码、补丁、search-replace。edit patch replace lines in file.',
  create_directory:
    '创建目录（含嵌套 mkdir -p）。新建文件夹、脚手架路径。mkdir create folder directory.',
  list_directory:
    '列出目录下文件与子目录（[FILE]/[DIR]）。浏览文件夹、看有哪些文件。ls list dir contents.',
  list_directory_with_sizes:
    '列出目录条目并带文件大小，可按名称或大小排序。du ls -lh sizes.',
  directory_tree:
    '递归目录树 JSON，可排除模式。看项目结构、文件树。tree recursive folder structure.',
  move_file:
    '移动或重命名文件/目录。mv rename move path.',
  search_files:
    '按名称模式递归搜索文件与目录。找文件名、glob、locate。search find files by name pattern.',
  get_file_info:
    '查看文件/目录元数据：大小、时间、权限、类型，不读内容。stat file info metadata.',
  // 与 openfile 同名 → 必须带前缀
  'filesystem__list_allowed_directories':
    '列出 filesystem MCP 允许访问的根目录（工作区 jail）。allowed filesystem roots workspace boundaries.',
}

export const MCP_OPENFILE_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  open_folder:
    '在系统文件管理器中打开文件夹；若给文件路径则打开其所在目录。reveal in explorer, show folder, open directory UI.',
  'openfile__list_allowed_directories':
    '列出 openfile MCP 允许打开的根目录；空表示未限制。openfile allowed roots path jail.',
}

export const MCP_MODSEARCH_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  web_search:
    '联网搜索网页/资讯，返回摘要与结果列表（可 DuckDuckGo 兜底）。搜索、查资料、google。web search internet query.',
  read_page:
    '抓取单个网页正文（可带关注点 query）。打开链接、读文章、爬页面。fetch url read webpage scrape page.',
}

/** Node vm2 沙箱；与 pyodide 工具名重叠处一律带 vmsandbox__ 前缀 */
export const MCP_VMSANDBOX_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  'vmsandbox__run_workspace_script':
    '用 NodeVM 执行工作区 scripts/ 下 JS，可 require 已装 npm 包。跑 node 脚本、本地计算。run workspace js script vm2.',
  'vmsandbox__list_workspace_scripts':
    '列出工作区 scripts/ 下 .js/.cjs/.mjs。list node scripts in workspace.',
  'vmsandbox__ensure_trusted_packages':
    '校验并 npm install 可信包到工作区（白名单或高周下载量）。安装依赖、加 lodash。install trusted npm packages.',
  'vmsandbox__check_package_trust':
    '只校验 npm 包是否可信，不安装。check npm package trust downloads allowlist.',
  run_js:
    '内联短 JavaScript（无 require）。算表达式、小段 JS。eval inline js no require.',
}

/** Pyodide WASM Python；重叠名带 pyodide__ 前缀 */
export const MCP_PYODIDE_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  'pyodide__run_workspace_script':
    '用 Pyodide 执行工作区 scripts/ 下 Python。跑 py 脚本、数据分析。run workspace python script pyodide.',
  'pyodide__list_workspace_scripts':
    '列出工作区 scripts/ 下 .py。list python scripts in workspace.',
  'pyodide__ensure_trusted_packages':
    '校验并安装可信 PyPI 包到 Pyodide（loadPackage/micropip）。装 numpy pandas。install trusted python packages.',
  'pyodide__check_package_trust':
    '只校验 PyPI 包是否可信，不安装。check pypi package trust downloads allowlist.',
  run_py:
    '内联短 Python（Pyodide）。算数、小段代码。eval inline python pyodide.',
}

/** @playwright/mcp — 裸名唯一，可直接用 browser_* */
export const MCP_PLAYWRIGHT_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  browser_navigate:
    '浏览器打开/跳转到 URL。访问网站、打开链接。navigate goto open url page.',
  browser_navigate_back:
    '浏览器历史后退。上一页、返回。go back history.',
  browser_navigate_forward:
    '浏览器历史前进。下一页。go forward history.',
  browser_reload:
    '刷新当前页面。reload refresh page.',
  browser_close:
    '关闭当前页面/浏览器。close browser tab page.',
  browser_resize:
    '调整浏览器窗口大小。resize viewport window.',
  browser_snapshot:
    '捕获页面无障碍树快照（交互首选，优于截图）。page a11y snapshot accessibility tree.',
  browser_take_screenshot:
    '截取当前页截图（勿据此点击，交互用 snapshot）。screenshot capture page image.',
  browser_click:
    '点击页面元素（需 snapshot 的 ref）。click button link.',
  browser_drag:
    '在两元素间拖拽。drag drop element.',
  browser_drop:
    '向外拖入文件或 MIME 数据到元素。drop files onto element.',
  browser_hover:
    '悬停在元素上。hover mouse over.',
  browser_type:
    '向可编辑元素输入文本。type fill input textbox.',
  browser_press_key:
    '按下键盘按键（如 Enter、Tab）。press key keyboard.',
  browser_press_sequentially:
    '逐键输入文本。type key by key sequentially.',
  browser_keydown:
    '按住键不放。keydown hold key.',
  browser_keyup:
    '松开按键。keyup release key.',
  browser_select_option:
    '下拉框选择选项。select dropdown option.',
  browser_check:
    '勾选复选框或单选。check checkbox radio.',
  browser_uncheck:
    '取消勾选复选框。uncheck checkbox.',
  browser_fill_form:
    '批量填写多个表单字段。fill form fields.',
  browser_file_upload:
    '上传一个或多个文件。upload file input.',
  browser_handle_dialog:
    '处理 alert/confirm/prompt 对话框。accept dismiss dialog.',
  browser_evaluate:
    '在页面或元素上执行 JavaScript。evaluate js in page.',
  browser_find:
    '在当前 snapshot 中按文本/正则查找节点与 ref。find search in snapshot.',
  browser_wait_for:
    '等待文本出现/消失或指定时长。wait for text timeout.',
  browser_tabs:
    '列出/新建/关闭/切换浏览器标签。manage tabs.',
  browser_console_messages:
    '获取页面 console 日志。console messages logs.',
  browser_console_clear:
    '清空 console 消息缓冲。clear console.',
  browser_network_requests:
    '列出页面加载以来的网络请求。list network requests.',
  browser_network_request:
    '查看单条网络请求详情（头/体）。network request details.',
  browser_network_clear:
    '清空网络请求记录。clear network log.',
  browser_network_state_set:
    '设置在线/离线网络状态。set online offline.',
  browser_route:
    '按 URL 模式 mock 网络请求。mock route intercept.',
  browser_route_list:
    '列出已注册的网络路由。list routes.',
  browser_unroute:
    '移除网络路由。unroute remove mock.',
  browser_pdf_save:
    '将当前页保存为 PDF。save page pdf.',
  browser_cookie_list:
    '列出 cookies。list cookies.',
  browser_cookie_get:
    '按名称获取 cookie。get cookie.',
  browser_cookie_set:
    '设置 cookie。set cookie.',
  browser_cookie_delete:
    '删除指定 cookie。delete cookie.',
  browser_cookie_clear:
    '清除全部 cookies。clear cookies.',
  browser_localstorage_list:
    '列出 localStorage。list localStorage.',
  browser_localstorage_get:
    '读取 localStorage 项。get localStorage.',
  browser_localstorage_set:
    '写入 localStorage 项。set localStorage.',
  browser_localstorage_delete:
    '删除 localStorage 项。delete localStorage.',
  browser_localstorage_clear:
    '清空 localStorage。clear localStorage.',
  browser_sessionstorage_list:
    '列出 sessionStorage。list sessionStorage.',
  browser_sessionstorage_get:
    '读取 sessionStorage 项。get sessionStorage.',
  browser_sessionstorage_set:
    '写入 sessionStorage 项。set sessionStorage.',
  browser_sessionstorage_delete:
    '删除 sessionStorage 项。delete sessionStorage.',
  browser_sessionstorage_clear:
    '清空 sessionStorage。clear sessionStorage.',
  browser_storage_state:
    '保存 cookies/localStorage 到文件。save storage state.',
  browser_set_storage_state:
    '从文件恢复 storage state。restore storage state.',
  browser_mouse_move_xy:
    '移动鼠标到坐标。mouse move xy.',
  browser_mouse_down:
    '鼠标按下。mouse down.',
  browser_mouse_up:
    '鼠标抬起。mouse up.',
  browser_mouse_wheel:
    '滚轮滚动。mouse wheel scroll.',
  browser_mouse_click_xy:
    '在坐标点击。click at xy.',
  browser_mouse_drag_xy:
    '拖拽鼠标到坐标。drag mouse xy.',
  browser_highlight:
    '高亮页面元素。highlight element overlay.',
  browser_hide_highlight:
    '取消元素高亮。hide highlight.',
  browser_annotate:
    '标注模式：用户手动画标注后返回截图与注解。annotate page dashboard.',
  browser_generate_locator:
    '为元素生成 Playwright locator（测试用）。generate locator.',
  browser_get_config:
    '获取合并后的 Playwright MCP 配置。get mcp config.',
  browser_resume:
    '恢复暂停的脚本执行（可单步）。resume paused script.',
  browser_start_recording:
    '开始录制用户操作为 Playwright 代码。start action recording.',
  browser_stop_recording:
    '停止录制并返回 Playwright 代码。stop recording get code.',
  browser_start_tracing:
    '开始 Playwright trace 录制。start tracing.',
  browser_stop_tracing:
    '停止 trace 录制。stop tracing.',
  browser_start_video:
    '开始视频录制。start video recording.',
  browser_stop_video:
    '停止视频录制。stop video.',
  browser_video_chapter:
    '在视频中加入章节卡片标记。video chapter marker.',
  browser_video_show_actions:
    '视频中显示操作标注叠加层。show action overlays on video.',
  browser_video_hide_actions:
    '关闭操作标注叠加层。hide action overlays.',
  browser_verify_element_visible:
    '断言元素可见。verify element visible.',
  browser_verify_list_visible:
    '断言列表可见。verify list visible.',
  browser_verify_text_visible:
    '断言文本可见。verify text visible.',
  browser_verify_value:
    '断言元素值。verify element value.',
  browser_run_code_unsafe:
    '在服务端执行任意 Playwright 代码（不安全/等价 RCE）。unsafe run playwright code.',
}

/** 合并表；后者覆盖同名 key（同名冲突应已用前缀消解） */
export const MCP_TOOL_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  ...MCP_FILESYSTEM_DESCRIPTION_OVERRIDES,
  ...MCP_OPENFILE_DESCRIPTION_OVERRIDES,
  ...MCP_MODSEARCH_DESCRIPTION_OVERRIDES,
  ...MCP_VMSANDBOX_DESCRIPTION_OVERRIDES,
  ...MCP_PYODIDE_DESCRIPTION_OVERRIDES,
  ...MCP_PLAYWRIGHT_DESCRIPTION_OVERRIDES,
}

function bareToolName(prefixedOrBare: string): string {
  const i = prefixedOrBare.indexOf('__')
  return i >= 0 ? prefixedOrBare.slice(i + 2) : prefixedOrBare
}

/** 解析覆盖文案：先全名（含 server__），再裸名。 */
export function resolveMcpDescriptionOverride(
  toolName: string,
  overrides: Readonly<Record<string, string>> = MCP_TOOL_DESCRIPTION_OVERRIDES,
): string | undefined {
  return overrides[toolName] ?? overrides[bareToolName(toolName)]
}

export function setToolDescription(tool: StructuredToolInterface, description: string): void {
  try {
    Object.defineProperty(tool, 'description', {
      value: description,
      writable: true,
      configurable: true,
      enumerable: true,
    })
  } catch {
    ;(tool as { description: string }).description = description
  }
}

export function applyMcpDescriptionOverrides(
  tools: StructuredToolInterface[],
  overrides: Readonly<Record<string, string>> = MCP_TOOL_DESCRIPTION_OVERRIDES,
): StructuredToolInterface[] {
  for (const tool of tools) {
    const next = resolveMcpDescriptionOverride(tool.name, overrides)
    if (next) setToolDescription(tool, next)
  }
  return tools
}

/**
 * 供向量索引：`server__tool` + 覆盖文案。
 * `toolName` 可为裸名或已带前缀；裸名时传 `server` 以匹配前缀专用条目。
 */
export function mcpToolEmbedText(
  toolName: string,
  server?: string,
): string | undefined {
  const bare = bareToolName(toolName)
  const prefixed =
    toolName.includes('__') ? toolName : server ? `${server}__${bare}` : bare
  const desc =
    MCP_TOOL_DESCRIPTION_OVERRIDES[prefixed] ??
    MCP_TOOL_DESCRIPTION_OVERRIDES[toolName] ??
    MCP_TOOL_DESCRIPTION_OVERRIDES[bare]
  if (!desc) return undefined
  return `${prefixed}: ${desc}`
}

/** @deprecated 使用 mcpToolEmbedText；保留兼容 */
export function filesystemToolEmbedText(toolName: string): string | undefined {
  return mcpToolEmbedText(toolName, 'filesystem')
}
