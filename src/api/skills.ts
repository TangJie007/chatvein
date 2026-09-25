import { backendRequest } from "./client";

export interface SkillCategory {
  id: string;
  label: string;
}

export interface SkillHubItem {
  slug: string;
  name: string;
  description: string;
  category: string;
  category_label: string;
  sub_categories: string[];
  downloads: number;
  installs: number;
  stars: number;
  version: string;
  icon_url: string | null;
  homepage: string;
  publisher: string;
  source: string;
  verified: boolean;
  updated_at: number | null;
}

export interface SkillHubCatalog {
  source: string;
  source_label: string;
  website: string;
  skills: SkillHubItem[];
  total: number;
  page: number;
  page_size: number;
  categories: SkillCategory[];
}

export type ListSkillsParams = {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  sortBy?: "score" | "downloads" | "updated_at";
};

/** 浏览 SkillHub 公开技能目录。 */
export function listSkills(params: ListSkillsParams = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  if (params.keyword?.trim()) q.set("keyword", params.keyword.trim());
  if (params.category?.trim()) q.set("category", params.category.trim());
  if (params.sortBy) q.set("sortBy", params.sortBy);
  const qs = q.toString();
  return backendRequest<SkillHubCatalog>(
    qs ? `/api/skills/?${qs}` : "/api/skills/"
  );
}

export interface SkillSecurityReport {
  provider: string;
  status: string;
  status_text: string;
  report_url: string;
}

export interface SkillHubDetail extends SkillHubItem {
  overview_md: string;
  skill_md: string | null;
  version_count: number;
  changelog: string;
  security_reports: SkillSecurityReport[];
  website: string;
  installed?: boolean;
}

export interface InstalledSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  homepage: string;
  installed_at: string;
  path: string;
}

/** 本机已安装技能。 */
export function listInstalledSkills() {
  return backendRequest<{ skills: InstalledSkill[]; total: number }>(
    "/api/skills/installed"
  );
}

/** 拉取单个技能详情（含可选 SKILL.md）。 */
export function getSkill(slug: string) {
  return backendRequest<SkillHubDetail>(
    `/api/skills/${encodeURIComponent(slug)}`
  );
}

/** 安装技能到本机。 */
export function installSkill(slug: string) {
  return backendRequest<SkillHubDetail & { local?: InstalledSkill }>(
    `/api/skills/${encodeURIComponent(slug)}/install`,
    "POST"
  );
}

/** 卸载本机技能。 */
export function uninstallSkill(slug: string) {
  return backendRequest<{ slug: string; removed: boolean }>(
    `/api/skills/${encodeURIComponent(slug)}`,
    "DELETE"
  );
}
