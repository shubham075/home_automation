// Dev seed: one platform org, one admin user, one demo site with rooms, this hub, and the SW6 device model.
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const db = new PrismaClient();

const siteId = process.env.SEED_SITE_ID ?? 'demo';
const phone = process.env.SEED_ADMIN_PHONE;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!phone || !password) throw new Error('Set SEED_ADMIN_PHONE and SEED_ADMIN_PASSWORD in .env');

const org = await db.organization.upsert({
  where: { id: 'platform' },
  create: { id: 'platform', name: 'SW6 Platform', type: 'platform' },
  update: {},
});

const admin = await db.user.upsert({
  where: { phone },
  create: { name: 'Admin', phone, passwordHash: await hash(password), phoneVerified: true },
  update: { passwordHash: await hash(password) },
});

await db.orgMembership.upsert({
  where: { orgId_userId: { orgId: org.id, userId: admin.id } },
  create: { orgId: org.id, userId: admin.id, role: 'org_owner' },
  update: {},
});

const site = await db.site.upsert({
  where: { id: siteId },
  create: {
    id: siteId,
    orgId: org.id,
    name: 'Demo Home',
    type: 'independent_house',
    city: 'Bengaluru',
    state: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    status: 'active',
  },
  update: {},
});

await db.siteMembership.upsert({
  where: { siteId_userId: { siteId: site.id, userId: admin.id } },
  create: { siteId: site.id, userId: admin.id, role: 'owner' },
  update: {},
});

if ((await db.floor.count({ where: { siteId: site.id } })) === 0) {
  const ground = await db.floor.create({ data: { siteId: site.id, name: 'Ground', level: 0 } });
  const rooms: [string, string][] = [
    ['Living', 'living'],
    ['Master Bedroom', 'bedroom'],
    ['Kitchen', 'kitchen'],
  ];
  for (const [i, [name, type]] of rooms.entries()) {
    await db.room.create({ data: { siteId: site.id, floorId: ground.id, name, type, sortOrder: i } });
  }
}

await db.hub.upsert({
  where: { serial: 'hub-dev-001' },
  create: { siteId: site.id, serial: 'hub-dev-001', hostname: 'sw6hub.local', swVersion: '0.1.0', status: 'online' },
  update: {},
});

await db.deviceModel.upsert({
  where: { sku: 'SW6' },
  create: {
    sku: 'SW6',
    name: 'SW6 6-channel retrofit switch',
    category: 'switch',
    protocol: 'wifi',
    channelCount: 6,
    capabilities: ['ota', 'identify', 'restore_policy', 'input_mode'],
  },
  update: {},
});

console.log(`Seeded site "${site.id}" with admin ${phone}`);
await db.$disconnect();
