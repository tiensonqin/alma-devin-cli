export async function activate(context) {
  const { createApi, ensureProvider, discoverModels, summary } = await import(`./lib/alma.mjs?activation=${Date.now()}`);
  const api = () => createApi(context.settings.get('devin.apiUrl', 'http://localhost:23001'));
  let pending;
  const ensure = () => pending ||= ensureProvider(api(), context.settings.get('devin.command', 'devin'))
    .finally(() => { pending = undefined; });
  const notifyError = error => {
    context.logger.warn(error.message);
    context.ui.showNotification(error.message, { type: 'error' });
  };
  const disposables = [
    context.commands.register('status', async () => {
      const { provider } = await ensure();
      const result = summary(provider);
      context.ui.showNotification(`Devin ACP：${provider.enabled ? '已启用' : '已停用'}，${result.availableModelCount} 个缓存模型。手机须连接此 Mac。`, { type: 'info' });
      return result;
    }),
    context.commands.register('refreshModels', async () => {
      const { provider } = await ensure();
      const models = await discoverModels(api(), provider);
      context.ui.showNotification(`Devin ACP：发现 ${models.length} 个原生模型。`, { type: 'info' });
      return { providerId: provider.id, modelCount: models.length };
    }),
  ];
  try {
    const { provider, created } = await ensure();
    if (created) await discoverModels(api(), provider);
    context.logger.info(`Devin native ACP ready: ${provider.id}`);
  } catch (error) {
    notifyError(error);
  }
  return { dispose() { disposables.forEach(disposable => disposable.dispose()); } };
}
