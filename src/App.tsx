import React from 'react';
import { PluginContainer } from './components/PluginContainer';

export default function App(): React.ReactElement {
  return (
    <main className="app-root">
      <header className="header">
        <h1>Project Orbit Host</h1>
        <p>Webpack 5 Module Federation Hot-Plug Toolbox Host</p>
      </header>

      <PluginContainer
        pluginUrl="http://localhost:3001/remoteEntry.js"
        pluginId="analytics-tool"
        scope="analyticsPlugin"
        module="./plugin"
        theme="light"
        initialConfig={{ locale: 'zh-TW' }}
      />
    </main>
  );
}
