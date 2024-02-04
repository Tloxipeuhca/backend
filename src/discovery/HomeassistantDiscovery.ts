"use strict";

import IRfxcom  from "../rfxcom/interface";
import { Settings, SettingDevice } from "../settings";
import Mqtt from "../mqtt";
import { DeviceEntity } from "../models/models";
import { MQTTMessage } from "../models/mqtt";
import StateStore from "../store/state";
import logger from "../libs/logger";
import AbstractDiscovery from "./AbstractDiscovery";

export default class HomeassistantDiscovery extends AbstractDiscovery {
  protected state: StateStore;
  protected devicesConfig: SettingDevice[];

  constructor(
    mqtt: Mqtt,
    rfxtrx: IRfxcom,
    config: Settings,
    state: StateStore,
  ) {
    super(mqtt, rfxtrx, config);
    this.devicesConfig = config.rfxcom.devices;
    this.state = state;
  }

  async start() {
    super.start();
    this.state.start();
  }

  async stop() {
    super.stop();
    this.state.stop();
  }

  onMQTTMessage(data: MQTTMessage) {
    const value = data.message.toString("utf8");
    logger.info(`Mqtt cmd from discovery :${data.topic} ${value}`);
    const dn = data.topic.split("/");
    const deviceType = dn[2];
    const id = dn[4];
    const subTypeValue = dn[3];
    let entityName = id;
    let entityTopic = id;
    let unitCode = 1;

    //TODO check data

    // Used for units and forms part of the device id
    if (dn[5] !== undefined && dn[5] !== "set" && dn[5].length > 0) {
      unitCode = parseInt(dn[5]);
      entityTopic += "/" + unitCode;
      entityName += "_" + unitCode;
    }

    logger.debug(`update ${deviceType}.${entityName} with value ${value}`);

    // get from save state
    const entityState = this.state.get({
      id: entityName,
      type: deviceType,
      subtype: data.message.subtype,
    });
    entityState.deviceType = deviceType;
    this.updateEntityStateFromValue(entityState, value);
    this.rfxtrx.sendCommand(
      deviceType,
      subTypeValue,
      entityState.rfxFunction,
      entityTopic,
    );
    this.mqtt.publish(
      this.mqtt.topics.devices + "/" + entityName,
      JSON.stringify(entityState),
      (error: any) => {},
      { retain: true, qos: 1 },
    );
  }

  updateEntityStateFromValue(entityState: any, value: string) {
    if (
      entityState.deviceType === "lighting1" ||
      entityState.deviceType === "lighting2" ||
      entityState.deviceType === "lighting3" ||
      entityState.deviceType === "lighting5" ||
      entityState.deviceType === "lighting6"
    ) {
      const cmd = value.toLowerCase().split(" ");
      let command = cmd[0];
      if (cmd[0] === "group") {
        command = cmd[1];
      }
      if (command === "on") {
        entityState.commandNumber = cmd[0] === "group" ? 4 : 1; //WORK only for lithing2
        entityState.rfxFunction = "switchOn";
      } else if (command === "off") {
        entityState.rfxFunction = cmd[0] === "group" ? 3 : 0; //WORK only for lithing2
        entityState.rfxCommand = "switchOff";
      } else {
        if (cmd[0] === "level") {
          entityState.rfxFunction = "setLevel";
          entityState.rfxOpt = cmd[1];
        }
      }
    } else if (entityState.deviceType === "lighting4") {
      entityState.rfxFunction = "sendData";
    } else if (entityState.deviceType === "chime1") {
      entityState.rfxFunction = "chime";
    } else {
      logger.error(
        "device type (" + entityState.deviceType + ") not supported",
      );
    }

    //TODO get command for other deviceType
  }

  publishDiscoveryToMQTT(payload: any) {
    const devicePrefix = this.config.discovery_device;
    const id = payload.id;
    const deviceId = payload.subTypeValue + "_" + id.replace("0x", "");
    let deviceTopic = payload.id;
    let deviceName = deviceId;
    let entityId = payload.subTypeValue + "_" + id.replace("0x", "");
    let entityName = payload.id;
    let entityTopic = payload.id;

    const deviceConf = this.devicesConfig.find((dev: any) => dev.id === id);

    if (deviceConf?.name !== undefined) {
      entityTopic = deviceConf.name;
      deviceTopic = deviceConf.name;
    }

    if (payload.unitCode !== undefined && !this.rfxtrx.isGroup(payload)) {
      entityId += "_" + payload.unitCode;
      entityTopic += "/" + payload.unitCode;
      entityName += "_" + payload.unitCode;
      if (deviceConf?.units) {
        deviceConf?.units.forEach((unit) => {
          if (parseInt(unit.unitCode) === parseInt(payload.unitCode)) {
            if (unit.name!) {
              entityTopic = unit.name;
            }
          }
        });
      }
    }

    this.state.set(
      { id: entityName, type: payload.type, subtype: payload.subtype },
      payload,
      "event",
    );

    if (deviceConf?.friendlyName) {
      deviceName = deviceConf?.friendlyName;
    }

    const deviceJson = new DeviceEntity(
      [devicePrefix + "_" + deviceId, devicePrefix + "_" + deviceName],
      deviceName,
    );

    this.publishDiscoverySensorToMQTT(
      payload,
      deviceJson,
      deviceName,
      deviceTopic,
      entityTopic,
      devicePrefix,
    );
    this.publishDiscoverySwitchToMQTT(
      payload,
      deviceJson,
      entityTopic,
      devicePrefix,
      entityId,
    );
  }

  publishDiscoverySwitchToMQTT(
    payload: any,
    deviceJson: any,
    entityTopic: any,
    devicePrefix: any,
    entityId: any,
  ) {
    if (
      payload.type === "lighting1" ||
      payload.type === "lighting2" ||
      payload.type === "lighting3" ||
      payload.type === "lighting5" ||
      payload.type === "lighting6"
    ) {
      let state_off = "Off";
      let state_on = "On";
      let entityName = entityId;
      if (this.rfxtrx.isGroup(payload)) {
        state_off = "Group off";
        state_on = "Group On";
        entityName += "_group";
      }

      const json = {
        availability: [{ topic: this.topicWill }],
        device: deviceJson,
        enabled_by_default: true,
        payload_off: state_off,
        payload_on: state_on,
        json_attributes_topic: this.topicDevice + "/" + entityTopic,
        command_topic:
          this.mqtt.topics.base +
          "/cmd/" +
          payload.type +
          "/" +
          payload.subtype +
          "/" +
          entityTopic +
          "/set",
        name: entityName,
        object_id: entityId,
        origin: this.discoveryOrigin,
        state_off: state_off,
        state_on: state_on,
        state_topic: this.topicDevice + "/" + entityTopic,
        unique_id: entityId + "_" + devicePrefix,
        value_template: "{{ value_json.command }}",
      };
      this.publishDiscovery(
        "switch/" + entityTopic + "/config",
        JSON.stringify(json),
      );
    }

    //"activlink", "asyncconfig", "asyncdata", "blinds1", "blinds2", "camera1", "chime1", "curtain1", "edisio",
    //"fan", "funkbus", "homeConfort", "hunterFan", "lighting4",
    // "radiator1", "remote", "rfy", "security1", "thermostat1", "thermostat2", "thermostat3", "thermostat4", "thermostat5"
  }

  publishDiscoverySensorToMQTT(
    payload: any,
    deviceJson: any,
    deviceName: any,
    deviceTopic: any,
    entityTopic: any,
    devicePrefix: any,
  ) {
    if (payload.rssi !== undefined) {
      const json = {
        availability: [{ topic: this.topicWill }],
        device: deviceJson,
        enabled_by_default: false,
        entity_category: "diagnostic",
        icon: "mdi:signal",
        json_attributes_topic: this.topicDevice + "/" + entityTopic,
        name: deviceName + " Linkquality",
        object_id: deviceTopic + "_linkquality",
        origin: this.discoveryOrigin,
        state_class: "measurement",
        state_topic: this.topicDevice + "/" + entityTopic,
        unique_id: deviceTopic + "_linkquality_" + devicePrefix,
        unit_of_measurement: "dBm",
        value_template: "{{ value_json.rssi }}",
      };
      this.publishDiscovery(
        "sensor/" + deviceTopic + "/linkquality/config",
        JSON.stringify(json),
      );
    }
    // batteryLevel
    if (payload.batteryLevel !== undefined) {
      const json = {
        availability: [{ topic: this.topicWill }],
        device: deviceJson,
        device_class: "battery",
        enabled_by_default: true,
        icon: "mdi:battery",
        json_attributes_topic: this.topicDevice + "/" + entityTopic,
        name: deviceName + " Batterie",
        object_id: deviceTopic + "__battery",
        origin: this.discoveryOrigin,
        state_class: "measurement",
        state_topic: this.topicDevice + "/" + entityTopic,
        unique_id: deviceTopic + "_battery_" + devicePrefix,
        unit_of_measurement: "%",
        value_template: "{{ value_json.batteryLevel }}",
      };
      this.publishDiscovery(
        "sensor/" + deviceTopic + "/battery/config",
        JSON.stringify(json),
      );
    }
    // batteryVoltage
    if (payload.batteryVoltage !== undefined) {
      const json = {
        availability: [{ topic: this.topicWill }],
        device: deviceJson,
        device_class: "voltage",
        enabled_by_default: true,
        icon: "mdi:sine-wave",
        json_attributes_topic: this.topicDevice + "/" + entityTopic,
        name: deviceName + " Tension",
        object_id: deviceTopic + "__voltage",
        origin: this.discoveryOrigin,
        state_class: "measurement",
        state_topic: this.topicDevice + "/" + entityTopic,
        unique_id: deviceTopic + "_voltage_" + devicePrefix,
        unit_of_measurement: "mV",
        value_template: "{{ value_json.batteryVoltage }}",
      };
      this.publishDiscovery(
        "sensor/" + deviceTopic + "/voltage/config",
        JSON.stringify(json),
      );
    }

    //
  }
}
