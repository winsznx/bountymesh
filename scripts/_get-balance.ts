import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';

const POSTER_HEX = '0xa2d2b8caeeddf26edd3a08d6a2e8a0313f7d6c892c53a1b06015b328153a0b1f';

async function main() {
  await cryptoWaitReady();
  const kr = new Keyring({ type: 'sr25519', ss58Format: 137 });
  const addr = kr.encodeAddress(POSTER_HEX, 137);
  const api = await GearApi.create({ providerAddress: 'wss://archive-rpc.vara.network' });
  await api.isReady;
  const acct = await api.query.system.account(addr);
  const data = (acct as any).data ?? acct;
  const free = BigInt(data.free.toString());
  const reserved = BigInt(data.reserved.toString());
  process.stdout.write(JSON.stringify({ address: addr, free: free.toString(), reserved: reserved.toString(), freeVara: Number(free) / 1e12 }) + '\n');
  await api.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
