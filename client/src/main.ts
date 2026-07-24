// SPA entry: self-hosted fonts (no CDN — CSP connect-src 'self'), theme, shell.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { applyTheme, readThemePref } from './lib/theme.svelte.js';

// Apply the saved theme before mount so there's no flash of the wrong palette.
// 'system' leaves the attribute off and lets the CSS @media rule decide.
applyTheme(readThemePref());

mount(App, { target: document.getElementById('app')! });
