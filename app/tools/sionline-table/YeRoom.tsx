// Точка входа для «Прогона в SIGame»: настоящая комната SIOnline (components/views/Room) — то, что видит
// игрок в браузере и на телефоне: стол, игроки, панель кнопок. Store — из LibraryCore (как у стола SImulator):
// сообщения сервера приходят через window.chrome.webview как { type: 'raw' } и идут в MessageProcessor.
// Файл копируется в SIOnline/src при сборке (npm run sigame-build) и собирается вебпаком SIOnline.

import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import React from 'react';
import runCore from './LibraryCore';
import Room from './components/views/Room/Room';
import { AudioContextProvider } from './contexts/AudioContextProvider';
import { windowSizeChanged } from './state/uiSlice';
import { setRoomRole } from './state/room2Slice';
import { changeLogin } from './state/userSlice';
import Role from './model/Role';
import localization from './model/resources/localization';

import './scss/style.scss';

export function run(elementId: string, login: string): void {
	const host = document.getElementById(elementId);

	if (!host) {
		throw new Error('Host element not found');
	}

	localization.setLanguage('ru');
	const store = runCore();
	store.dispatch(changeLogin(login));
	store.dispatch(setRoomRole(Role.Player));
	store.dispatch(windowSizeChanged({ width: window.innerWidth, height: window.innerHeight }));
	window.addEventListener('resize', () => store.dispatch(windowSizeChanged({ width: window.innerWidth, height: window.innerHeight })));

	ReactDOM.render(
		<Provider store={store}>
			<AudioContextProvider>
				<div className="app">
					<Room />
				</div>
			</AudioContextProvider>
		</Provider>,
		host
	);
}
