import rfxcom from "rfxcom";
import { settingsService } from "../settings";
import { RfxcomInfo, RfxcomEvent } from "../models/rfxcom";
import IRfxcom from "./interface";
import MockRfxcom from "./Mock";

import { loggerFactory } from "../utils/logger";
const logger = loggerFactory.getLogger("RFXCOM");

export { IRfxcom };

export function getRfxcomInstance(): IRfxcom {
  return settingsService.get().rfxcom.usbport === "mock"
    ? new MockRfxcom()
    : new Rfxcom();
}

export default class Rfxcom implements IRfxcom {
  private debug: boolean;
  private rfxtrx;

  constructor() {
    this.debug = this.getConfig().debug ? this.getConfig().debug : false;
    this.rfxtrx = new rfxcom.RfxCom(this.getConfig().usbport, {
      debug: this.debug,
    });
  }

  private getConfig() {
    return settingsService.get().rfxcom;
  }

  private getRfxcomDevices() {
    return Object.keys(rfxcom);
  }

  get() {
    return this.rfxtrx;
  }

  isGroup(payload: any): boolean {
    if (payload.type === "lighting2") {
      return payload.commandNumber === 3 || payload.commandNumber === 4;
    }
    if (payload.type === "lighting1") {
      return payload.commandNumber === 5 || payload.commandNumber === 6;
    }
    if (payload.type === "lighting6") {
      return payload.commandNumber === 2 || payload.commandNumber === 3;
    }
    return false;
  }

  async initialise(): Promise<void> {
    logger.info(`Connecting to RFXCOM at ${this.getConfig().usbport}`);
    return new Promise((resolve, reject) => {
      this.rfxtrx.initialise(function (error: any) {
        if (error) {
          logger.error("Unable to initialise the RFXCOM device");
          reject("Unable to initialise the RFXCOM device");
        } else {
          logger.info("RFXCOM device initialised");
          resolve();
        }
      });
    });
  }

  private validRfxcomDevice(device: any) {
    return (
      this.getRfxcomDevices().find(
        (rfxcomDevice) => device === rfxcomDevice,
      ) !== undefined
    );
  }

  private validRfxcomDeviceFunction(device: any, deviceFunction: any) {
    if (rfxcom[device] === undefined) {
      return false;
    }

    const deviceFunctions = Object.getOwnPropertyNames(
      rfxcom[device].prototype,
    );
    return (
      deviceFunctions.find(
        (rfxcomDeviceFunction) => rfxcomDeviceFunction === deviceFunction,
      ) !== undefined
    );
  }

  protected enableRFXProtocols() {
    const config = this.getConfig();
    this.rfxtrx.enableRFXProtocols(config.receive, function (evt: any) {
      logger.info("RFXCOM enableRFXProtocols : " + config.receive);
    });
  }

  getStatus(callback: any) {
    this.rfxtrx.getRFXStatus(function (error: any) {
      if (error) {
        logger.error("Healthcheck: RFX Status ERROR");
        callback("offline");
      } else {
        callback("online");
      }
    });
  }

  onStatus(callback: any) {
    logger.info("RFXCOM listen status event");
    this.rfxtrx.on("status", function (evt: any) {
      const json = JSON.stringify(
        evt,
        function (key, value) {
          if (key === "subtype" || key === "seqnbr" || key === "cmnd") {
            return undefined;
          }
          return value;
        },
        2,
      );
      logger.info("RFXCOM listen status : " + json);
      if (json !== undefined) {
        logger.info("RFXCOM listen status : " + json);
        callback(JSON.parse(json) as RfxcomInfo);
      }
    });
  }

  onCommand(
    deviceType: string,
    entityName: string,
    payload: any,
    deviceConf: any,
  ) {
    let transmitRepetitions: number | undefined;
    let subtype: string;

    if (!this.validRfxcomDevice(deviceType)) {
      logger.warn(deviceType + " is not a valid device");
      return;
    }

    // We will need subType from payload
    subtype = payload.subtype;

    const deviceFunction = payload.deviceFunction;

    if (!this.validRfxcomDeviceFunction(deviceType, payload.deviceFunction)) {
      logger.warn(
        payload.deviceFunction +
          " is not a valid device function on " +
          deviceType,
      );
      return;
    }
    // We may also get a value from the payload to use in the device function
    const value = payload.value;
    let deviceOptions = payload.deviceOptions;

    // Get device config if available
    if (deviceConf instanceof Object) {
      if (deviceConf.id !== undefined) {
        entityName = deviceConf.id;
      }

      if (deviceConf.type !== undefined) {
        if (!this.validRfxcomDevice(deviceConf.type)) {
          throw new Error(deviceConf.type + " from config: not a valid device");
        }

        deviceType = deviceConf.type;
      }

      deviceOptions = deviceConf.options;

      if (deviceConf.subtype !== undefined) {
        subtype = deviceConf.subtype;
      }

      transmitRepetitions = deviceConf.repetitions;
    }

    if (subtype === undefined) {
      throw new Error("subtype not defined in payload or config");
    }

    // Instantiate the device class
    let device;
    if (deviceOptions) {
      device = new rfxcom[deviceType](
        this.rfxtrx.get(),
        payload.subtype,
        deviceOptions,
      );
    } else {
      device = new rfxcom[deviceType](this.rfxtrx.get(), payload.subtype);
    }

    const repeat: number = transmitRepetitions ? transmitRepetitions : 1;
    for (let i: number = 0; i < repeat; i++) {
      // Execute the command with optional value
      if (value) {
        device[deviceFunction](entityName, value);
      } else {
        device[deviceFunction](entityName);
      }

      logger.debug(
        deviceType +
          " " +
          entityName +
          "[" +
          deviceFunction +
          "][" +
          value +
          "]",
      );
    }
  }

  onDisconnect(callback: any) {
    logger.info("RFXCOM listen disconnect event");
    this.rfxtrx.on("disconnect", function (evt: any) {
      callback(evt);
      logger.info("RFXCOM Disconnected");
    });
  }

  subscribeProtocolsEvent(callback: any) {
    if (this.getConfig().receive) {
      // Subscribe to specific rfxcom events
      this.getConfig().receive.forEach((protocol: any) => {
        logger.info("RFXCOM listen event for protocol : " + protocol);
        this.rfxtrx.on(protocol, (evt: any, packetType: string) => {
          logger.info("receive " + protocol);
          // Add type to event
          evt.type = protocol;
          evt.deviceName = rfxcom.deviceNames[packetType][evt.subtype];
          let deviceId = evt.id;
          if (evt.type === "lighting4") {
            deviceId = evt.data;
          }
          if (this.isDeviceCommand(evt)) {
            evt.command = rfxcom.commandName(
              packetType,
              evt.subtype,
              evt.commandNumber,
            );
          }
          if (evt.type === "security1") {
            evt.status = this.getSecurityStatus(parseInt(evt.deviceStatus));
          }
          evt.group = this.isGroup(evt);
          evt.subTypeValue = this.getSubType(evt.type, evt.subtype);
          callback(protocol, evt as RfxcomEvent);
        });
      });
    }
  }

  isDeviceCommand(payload: any): boolean {
    if (
      payload.type === "lighting1" ||
      payload.type === "lighting2" ||
      payload.type === "lighting5" ||
      payload.type === "lighting6" ||
      payload.type === "chime1" ||
      payload.type === "fan" ||
      payload.type === "blinds1" ||
      payload.type === "edisio" ||
      payload.type === "activlink" ||
      payload.type === "funkbus" ||
      payload.type === "hunterFan" ||
      payload.type === "camera1" ||
      payload.type === "remote" ||
      payload.type === "blinds2" ||
      payload.type === "thermostat3"
    ) {
      return true;
    }
    return false;
  }

  getSecurityStatus(key: number): string {
    logger.info("Mock get security status : " + key);
    let returnValue = "";
    Object.keys(rfxcom.security)
      .filter(
        (ele, ind) =>
          ![
            "X10_DOOR_WINDOW_SENSOR",
            "X10_MOTION_SENSOR",
            "X10_SECURITY_REMOTE",
          ].includes(ele),
      )
      .forEach(function (statusValue: string) {
        if (key === parseInt(rfxcom.security[statusValue])) {
          returnValue = statusValue;
        }
      });

    return returnValue;
  }

  getSubType(type: string, subType: string): string {
    let returnValue = "";
    if (rfxcom.packetNames[type] !== undefined) {
      if (rfxcom[type] !== undefined) {
        rfxcom[type].forEach(function (subTypeName: string) {
          if (parseInt(subType) === parseInt(rfxcom[type][subTypeName])) {
            returnValue = subTypeName;
          }
        });
      }
    }

    return returnValue;
  }

  stop() {
    logger.info("Disconnecting from RFXCOM");
    this.rfxtrx.close();
  }

  sendCommand(
    deviceType: string,
    subTypeValue: string,
    command: string | undefined,
    entityName: string,
  ) {
    if (command !== undefined) {
      logger.debug(
        "send rfxcom command : " +
          command +
          " for device :" +
          deviceType +
          "." +
          entityName,
      );
      const subType = this.getSubType(deviceType, subTypeValue);
      const device = new rfxcom[this.capitalize(deviceType)](
        this.rfxtrx,
        subType,
      );
      device[command](entityName);
    }
  }

  private capitalize(str: string): string {
    return str.slice(0, 1).toUpperCase() + str.slice(1);
  }
}
