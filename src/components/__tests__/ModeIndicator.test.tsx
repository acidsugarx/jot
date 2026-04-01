import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FocusProvider } from '@/components/FocusProvider';
import { createFocusEngine } from '@/lib/focus-engine';

describe('ModeIndicator', () => {
  it('shows current mode', () => {
    const engine = createFocusEngine();
    render(
      <FocusProvider engine={engine}>
        <div>body</div>
      </FocusProvider>
    );

    expect(screen.getByText('[NORMAL]')).toBeInTheDocument();

    act(() => {
      engine.getState().setMode('INSERT');
    });

    expect(screen.getByText('[INSERT]')).toBeInTheDocument();
  });

  it('shows command marker in command mode', () => {
    const engine = createFocusEngine();

    act(() => {
      engine.getState().setMode('COMMAND');
      engine.getState().setCommandInput('search text');
    });

    render(
      <FocusProvider engine={engine}>
        <div>body</div>
      </FocusProvider>
    );

    expect(screen.getByText('[/ search text]')).toBeInTheDocument();
  });
});
