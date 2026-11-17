import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { armWake } from './app/wake';

armWake();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
