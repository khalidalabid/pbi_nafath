import { Service } from 'node-windows';

const svc = new Service({
  name: 'Service App',
  description: 'Service App',
  script: 'C:\\pbi_nafath\\src\\index.js',
  nodeOptions: ['--harmony', '--max_old_space_size=4096']
});

svc.on('install', () => {
  svc.start();
  console.log('Service installed and started!');
});

svc.install();