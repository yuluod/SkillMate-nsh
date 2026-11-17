// plan_token 单飞执行器:自原版 plannedAction.mjs 直译。
// 同一动作令牌只允许一次在飞执行;预览刷新使旧令牌失效,
// 确认按钮只认当前预览的 plan_token。
export type PlanState = "idle" | "running" | "done";

export function createPlannedAction<A extends unknown[], R>(
  run: (planToken: string | undefined, ...args: A) => Promise<R>,
) {
  let busy = false;
  return {
    get busy(): boolean {
      return busy;
    },
    async execute(planToken: string | undefined, ...args: A): Promise<R | null> {
      if (busy || !planToken) return null;
      busy = true;
      try {
        return await run(planToken, ...args);
      } finally {
        busy = false;
      }
    },
  };
}
