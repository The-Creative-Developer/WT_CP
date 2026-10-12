import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: (retry: () => void) => ReactNode;
}

// [CONCEPT: Error Boundaries] Contains a crash to one part of the page. React still needs a class component for
// this (getDerivedStateFromError has no hook equivalent).
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed
      ? this.props.fallback(() => this.setState({ failed: false }))
      : this.props.children;
  }
}
