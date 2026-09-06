import { defineMcpTools } from './build'
import { TOOL_CATALOG_GROUPS } from './groups'

const FILESYSTEM = TOOL_CATALOG_GROUPS.find((g) => g.id === 'mcp_filesystem')!

/** 默认集 6 个（read/write/edit/list/search/create）；其余按需（向量召回 / 显式白名单） */
export const FILESYSTEM_TOOLS = defineMcpTools(FILESYSTEM, [
  {
    tool: 'read_file',
    description:
      '已弃用：请改用 read_text_file。读取单个文本文件全文。deprecated alias for reading a text file.',
    deprecated: true,
    defaultEnabled: false,
  },
  {
    tool: 'read_text_file',
    description:
      '读取单个文本文件内容；可 head/tail 截取行。查看源码、配置、日志、说明。read text file, cat, view source, open file contents.',
  },
  {
    tool: 'read_media_file',
    description:
      '读取图片或音频等媒体文件，返回 base64 与 MIME。看图、听音频、嵌入资源。read image audio media binary as base64.',
    defaultEnabled: false,
  },
  {
    tool: 'read_multiple_files',
    description: '一次并行读取多个文本文件，便于对比或批量分析。batch read many files, compare sources.',
    defaultEnabled: false,
  },
  { tool: 'write_file', description: '新建或整文件覆盖写入文本。创建/保存/覆盖文件内容。write create overwrite save file.' },
  {
    tool: 'edit_file',
    description:
      '按精确文本片段做局部替换，返回 git diff；可 dryRun 预览。修改代码、补丁、search-replace。edit patch replace lines in file.',
  },
  { tool: 'create_directory', description: '创建目录（含嵌套 mkdir -p）。新建文件夹、脚手架路径。mkdir create folder directory.' },
  {
    tool: 'list_directory',
    description: '列出目录下文件与子目录（[FILE]/[DIR]）。浏览文件夹、看有哪些文件。ls list dir contents.',
  },
  {
    tool: 'list_directory_with_sizes',
    description: '列出目录条目并带文件大小，可按名称或大小排序。du ls -lh sizes.',
    defaultEnabled: false,
  },
  {
    tool: 'directory_tree',
    description: '递归目录树 JSON，可排除模式。看项目结构、文件树。tree recursive folder structure.',
    defaultEnabled: false,
  },
  { tool: 'move_file', description: '移动或重命名文件/目录。mv rename move path.', defaultEnabled: false },
  {
    tool: 'search_files',
    description: '按名称模式递归搜索文件与目录。找文件名、glob、locate。search find files by name pattern.',
  },
  {
    tool: 'get_file_info',
    description: '查看文件/目录元数据：大小、时间、权限、类型，不读内容。stat file info metadata.',
    defaultEnabled: false,
  },
  {
    tool: 'list_allowed_directories',
    description: '列出 filesystem MCP 允许访问的根目录（工作区 jail）。allowed filesystem roots workspace boundaries.',
    defaultEnabled: false,
  },
])
