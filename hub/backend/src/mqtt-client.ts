import mqtt from 'mqtt';
import { config } from './config';

export const mqttClient = mqtt.connect(config.MQTT_URL, {
  clientId: `hub-backend-${process.pid}`,
  username: config.MQTT_ADMIN_USER,
  password: config.MQTT_ADMIN_PASSWORD,
  clean: true,
  reconnectPeriod: 2000,
});
