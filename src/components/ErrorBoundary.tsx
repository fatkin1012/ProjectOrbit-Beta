import React from 'react';

interface ErrorBoundaryProps {
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage?: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: undefined
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[Plugin ErrorBoundary] runtime error', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="plugin-state plugin-state--error">
          <h3>Plugin Runtime Error</h3>
          <p>{this.state.errorMessage ?? 'Unknown error'}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
