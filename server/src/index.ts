import { buildServer } from './app.ts';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const app = buildServer();

app.listen(PORT).then(() => {
  console.log(`Castor server listening on port ${PORT}`);
});
