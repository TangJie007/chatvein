/**
 * 新建会话 / 新建群组的初始化步骤。后续要加阶段（知识库索引 / 技能挂载 / 沙箱预热等）
 * 只往这里加文案，驱动逻辑按顺序推进即可。
 */
export const CREATE_STEPS = ["创建会话", "初始化工作区", "准备就绪"] as const;
/** 创建请求通常几十毫秒就返回；至少展示 1s，避免加载提示一闪而过。 */
export const CREATE_MIN_MS = 1000;

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
