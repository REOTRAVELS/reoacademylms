// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReactionPicker, { REACTIONS } from './ReactionPicker.jsx';

afterEach(cleanup);

describe('ReactionPicker', () => {
  it('shows native emoji and sends the selected reaction', () => {
    const onPick = vi.fn();
    render(<ReactionPicker onPick={onPick} />);

    expect(screen.getAllByRole('menuitem')).toHaveLength(REACTIONS.length);
    expect(screen.queryByRole('img')).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: `React with ${REACTIONS[0]}` }));
    expect(onPick).toHaveBeenCalledWith(REACTIONS[0]);
  });
});
