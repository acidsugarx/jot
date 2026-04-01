import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FocusProvider } from '@/components/FocusProvider';
import { createFocusEngine } from '@/lib/focus-engine';
import { useFocusEngineStore } from '@/hooks/use-focus-engine';

function TestMode() {
  const mode = useFocusEngineStore((state) => state.mode);
  return <div data-testid="mode">{mode}</div>;
}

describe('FocusProvider', () => {
  it('dispatches keys into the focus engine', () => {
    const engine = createFocusEngine();

    render(
      <FocusProvider engine={engine} showIndicator={false} captureKeys>
        <TestMode />
      </FocusProvider>
    );

    expect(screen.getByTestId('mode')).toHaveTextContent('NORMAL');

    fireEvent.keyDown(window, { key: 'i' });
    expect(screen.getByTestId('mode')).toHaveTextContent('INSERT');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('mode')).toHaveTextContent('NORMAL');
  });

  it('forwards action callbacks', () => {
    const engine = createFocusEngine();
    const onNewItem = vi.fn();

    render(
      <FocusProvider engine={engine} showIndicator={false} captureKeys actions={{ onNewItem }}>
        <div>body</div>
      </FocusProvider>
    );

    fireEvent.keyDown(window, { key: 'n' });

    expect(onNewItem).toHaveBeenCalledTimes(1);
  });
});
