import { Service } from 'node-windows';

const svc = new Service({
  name: 'Service App',
  script: 'C:\\pbi_nafath\\src\\index.js'
});

svc.on('uninstall', () => console.log('Service uninstalled'));
svc.uninstall();