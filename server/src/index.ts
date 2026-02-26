import { buildServer } from './app.ts';

const app = buildServer();

app.listen(3001).then(() => {
  console.log('Calixte server listening on http://localhost:3001');
});
