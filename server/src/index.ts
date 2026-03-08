import { buildServer } from './app.ts';

const app = buildServer();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

app.listen(PORT).then(() => {
  console.log(`Calixte server listening on port ${PORT}`);
});
