import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: ''
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Render crash', error, info);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <section className="card card-error" role="alert" aria-live="assertive">
          <h2>UI Runtime Error</h2>
          <p>The host intercepted an unrecoverable render failure.</p>
          <pre>{this.state.message}</pre>
        </section>
      );
    }

    return this.props.children;
  }
}
