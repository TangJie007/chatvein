import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 顶层错误边界：任何渲染异常都收敛成可恢复的全屏提示，而不是白屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-page px-8 font-sans text-ink-900 antialiased select-none">
          <p className="text-sm font-medium text-danger-600">界面出现异常</p>
          <pre className="max-h-48 max-w-2xl overflow-auto whitespace-pre-wrap text-xs text-ink-500">
            {String(this.state.error)}
          </pre>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
