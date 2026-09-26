/** A local stand-in for Zuuvy's channel API with a control page at http://127.0.0.1:4010. */
import { startMockZuuvy } from "@zsite/connectors/zuuvy/mock";

const port = Number(process.env.MOCK_ZUUVY_PORT ?? 4010);
const mock = await startMockZuuvy({ port });
console.log(`mock zuuvy: ${mock.url} — organisation '${mock.tenant}', channel key '${mock.apiKey}'`);
process.on("SIGINT", () => mock.close().then(() => process.exit(0)));
process.on("SIGTERM", () => mock.close().then(() => process.exit(0)));
