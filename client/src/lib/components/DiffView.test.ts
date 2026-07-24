import { test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import DiffView from './DiffView.svelte';

afterEach(() => cleanup());

test('renders an Edit-style pair as red (old) then green (new) lines', () => {
  render(DiffView, { props: { filePath: 'src/foo.ts', pairs: [{ oldText: 'const x = 1;', newText: 'const x = 2;' }] } });

  expect(screen.getByTestId('diff-view-path')).toHaveTextContent('src/foo.ts');
  expect(screen.getByTestId('diff-del')).toHaveTextContent('const x = 1;');
  expect(screen.getByTestId('diff-add')).toHaveTextContent('const x = 2;');
});

test('a Write-style pair with no old side renders only the green line', () => {
  render(DiffView, { props: { filePath: 'src/new.ts', pairs: [{ oldText: '', newText: 'export const y = 3;' }] } });

  expect(screen.queryByTestId('diff-del')).not.toBeInTheDocument();
  expect(screen.getByTestId('diff-add')).toHaveTextContent('export const y = 3;');
});

test('renders one diff block per MultiEdit pair', () => {
  render(DiffView, {
    props: {
      filePath: 'src/multi.ts',
      pairs: [
        { oldText: 'a', newText: 'A' },
        { oldText: 'b', newText: 'B' },
      ],
    },
  });

  expect(screen.getAllByTestId('diff-del')).toHaveLength(2);
  expect(screen.getAllByTestId('diff-add')).toHaveLength(2);
});
