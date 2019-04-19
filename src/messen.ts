import facebook from 'facebook-chat-api';
import messen from 'messen';

import * as settings from './settings';

import * as helpers from './util/helpers';
import getLogger from './util/logger';
import api from './api';
import { ThreadStore } from './store/threads'

const logger = getLogger('messen');
if (settings.ENVIRONMENT !== 'production') {
  logger.info('Logging initialized at debug level');
}

const getAuth = async (
  promptCredentialsFn: () => Promise<facebook.Credentials>,
  credentials?: facebook.Credentials,
  useCache?: boolean,
): Promise<facebook.Credentials | { appState: facebook.AppState }> => {
  const useCredentials = () => {
    if (credentials) {
      return Promise.resolve(credentials);
    }
    return promptCredentialsFn();
  };

  if (!useCache) {
    return useCredentials();
  }

  try {
    const appState = await helpers
      .loadAppState(settings.APPSTATE_FILE_PATH);
    logger.debug('Appstate loaded successfully');
    return { appState };
  }
  catch (e) {
    logger.debug('Appstate not found. Falling back to provided credentials');
    return useCredentials();
  }
};

export class Messen {
  api: facebook.API;
  state: {
    authenticated: boolean;
  };
  store: {
    user: messen.MessenMeUser;
    threads: ThreadStore
  }
  options: any;
  constructor(options: any = {}) {
    this.options = options;
    this.state = {
      authenticated: false,
    };
    this.store = {
      user: undefined,
      threads: undefined
    }
  }

  getMfaCode(): Promise<string> {
    return Promise.reject(Error('getMfaCode not implemented'));
  }

  promptCredentials(): Promise<facebook.Credentials> {
    return Promise.reject(Error('promptCredentials not implemented'));
  }

  async login(
    credentials?: facebook.Credentials,
    useCache: boolean = true,
  ): Promise<messen.MessenMeUser> {
    const apiConfig = {
      forceLogin: true,
      logLevel: this.options.debug ? 'info' : 'silent',
      selfListen: true,
      listenEvents: true,
    };

    const authPayload = await getAuth(this.promptCredentials, credentials, useCache);
    this.api = await api.getApi(authPayload, apiConfig, this.getMfaCode);
    await helpers.saveAppState(this.api.getAppState(), settings.APPSTATE_FILE_PATH);
    logger.debug('App state saved');
    this.state.authenticated = true;

    this.store = {
      user: undefined,
      threads: new ThreadStore(this.api)
    }

    const [user, friends] = await Promise.all([
      api.fetchUserInfo(this.api, this.api.getCurrentUserID()),
      api.fetchApiUserFriends(this.api),
      this.store.threads.refresh() // refresh thread store
    ]);

    this.store.user = Object.assign(user, { friends });
    this.store.threads.setUser(this.store.user)

    return this.store.user;
  }

  onMessage(ev: facebook.MessageEvent): void | Error {
    return Error('onMessage not implemented');
  }

  onThreadEvent(ev: facebook.EventEvent): void | Error {
    return Error('onThreadEvent not implemented');
  }

  listen(): void {
    this.api.listen((err, ev) => {
      if (err) {
        return logger.error(err);
      }

      // inject thread data in to event
      return this.store.threads.getThread({ id: ev.threadID }).then(thread => {
        const messenEvent = Object.assign(ev, {
          thread
        })

        switch (messenEvent.type) {
          case 'message':
            return this.onMessage(messenEvent);
          case 'event':
            return this.onThreadEvent(messenEvent);
        }
      })
    });
  }

  async logout(): Promise<void> {
    await Promise.all([
      api.logout(this.api),
      helpers.clearAppState(settings.APPSTATE_FILE_PATH)
    ]);

    this.state.authenticated = false;
  }
}