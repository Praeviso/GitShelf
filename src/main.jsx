import { render } from 'preact';
import './style.css';
import { App } from './components/App';
import { PasswordGate } from './components/PasswordGate';

render(
  <PasswordGate>
    <App />
  </PasswordGate>,
  document.getElementById('app'),
);
