import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
