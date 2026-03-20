import { render, screen } from '@testing-library/react';

import App from './App';

describe('App', () => {
  it('renders the popup shell', () => {
    render(<App />);

    expect(screen.getByPlaceholderText(/type a task/i)).toBeInTheDocument();
  });
});
