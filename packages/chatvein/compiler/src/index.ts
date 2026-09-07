/**
 * @chatvein/compiler
 *
 * Requirement compiler: Markdown requirement doc → structured TaskTree.
 * M1 is deterministic (section split, zero model calls); M2 adds strong-model
 * extraction of feature points + acceptance criteria per section.
 */

export const CHATVEIN_COMPILER_VERSION = '0.1.0'

export { splitMarkdownSections, extractAcceptance, type MdSection } from './sections'
export {
  compileRequirement,
  compileToFile,
  type CompileOptions,
} from './compile'
