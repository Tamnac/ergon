import { render } from 'solid-js/web';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';

render(() => <App />, document.getElementById('root')!);
