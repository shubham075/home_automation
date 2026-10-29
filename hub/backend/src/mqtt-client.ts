import mqtt from 'mqtt';
import { config } from './config';

export const mqttClient = mqtt.connect(config.MQTT_URL, {
  clientId: `hub-backend-${process.pid}`,
  clean: true,
  reconnectPeriod: 2000,
});
