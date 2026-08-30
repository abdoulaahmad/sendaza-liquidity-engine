import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('reports that the process is live', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('reports that the service is ready', () => {
    expect(controller.ready()).toEqual({ status: 'ready' });
  });
});
