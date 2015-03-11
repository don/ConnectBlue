// (c) 2014-2015 Don Coleman
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/* global mainPage, deviceList, refreshButton */
/* global detailPage, resultDiv, messageInput, sendButton, disconnectButton */
/* global ble, cordova  */
/* jshint browser: true , devel: true*/
'use strict';

// ASCII only
function bytesToString(buffer) {
    return String.fromCharCode.apply(null, new Uint8Array(buffer));
}

// ASCII only
function stringToBytes(string) {
    var array = new Uint8Array(string.length);
    for (var i = 0, l = string.length; i < l; i++) {
        array[i] = string.charCodeAt(i);
    }
    return array.buffer;
}

// this is ConnectBlue's UART service
// http://support.connectblue.com/display/PRODBTSPA/connectBlue+Low+Energy+Serial+Port+Service
// TODO consider combining tx and rx into FIFO
var connectBlue = {
    serviceUUID: "2456e1b9-26e2-8f83-e744-f34f01e9d701",
    txCharacteristic: "2456e1b9-26e2-8f83-e744-f34f01e9d703", // transmit is from the phone's perspective
    rxCharacteristic: "2456e1b9-26e2-8f83-e744-f34f01e9d703",  // receive is from the phone's perspective
    creditsCharacteristic: "2456e1b9-26e2-8f83-e744-f34f01e9d704"
};

var app = {
    txCredits: 0,
    rxCredits: 0,
    deviceId: null,
    initialize: function() {
        this.bindEvents();
        detailPage.hidden = true;
    },
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
        refreshButton.addEventListener('touchstart', this.refreshDeviceList, false);
        sendButton.addEventListener('click', this.sendData, false);
        clearButton.addEventListener('click', this.clearTextInput, false);
        disconnectButton.addEventListener('touchstart', this.disconnect, false);
        deviceList.addEventListener('touchstart', this.connect, false); // assume not scrolling
    },
    onDeviceReady: function() {
        app.refreshDeviceList();
    },
    refreshDeviceList: function() {
        deviceList.innerHTML = ''; // empties the list
        if (cordova.platformId === 'android') { // Android filtering is broken
            ble.scan([], 5, app.onDiscoverDevice, app.onError);
        } else {
            ble.scan([connectBlue.serviceUUID], 5, app.onDiscoverDevice, app.onError);
        }
    },
    onDiscoverDevice: function(device) {
        var listItem = document.createElement('li'),
            html = '<b>' + device.name + '</b><br/>' +
                'RSSI: ' + device.rssi + '&nbsp;|&nbsp;' +
                device.id;

        listItem.dataset.deviceId = device.id;
        listItem.innerHTML = html;
        deviceList.appendChild(listItem);
    },
    connect: function(e) {
        var deviceId = e.target.dataset.deviceId,
            onConnect = function() {

                app.txCredits = 0;
                app.rxCredits = 0;

                messageInput.value = "Hello, world!";
                resultDiv.innerHTML = ""; // clear old data

                // the documentation lists credits as optional, but they appear to be required
                // http://support.connectblue.com/display/PRODBTSPA/connectBlue+Low+Energy+Serial+Port+Service
                ble.startNotification(deviceId, connectBlue.serviceUUID,
                    connectBlue.creditsCharacteristic, app.onReceiveCredits, app.onError);

                // subscribe for incoming data, must happen after creditsCharacteristic
                ble.startNotification(deviceId, connectBlue.serviceUUID,
                    connectBlue.rxCharacteristic, app.onData, app.onError);

                // send credits to the server
                app.deviceId = deviceId; // save in app, since onData doesn't have reference to device
                app.sendCredits();

                sendButton.dataset.deviceId = deviceId;
                disconnectButton.dataset.deviceId = deviceId;
                app.showDetailPage();
            };

        ble.connect(deviceId, onConnect, app.onError);
    },
    onData: function(buffer) { // data received from Arduino
        var data = bytesToString(buffer);
        console.log(data);
        resultDiv.innerHTML = resultDiv.innerHTML + "Received: " + data + "<br/>";
        resultDiv.scrollTop = resultDiv.scrollHeight;

        app.rxCredits--;
        if (app.rxCredits <= 0) {
            app.sendCredits();
        }
        app.displayCredits();
    },
    onReceiveCredits: function(buffer) {
        var data = new Uint8Array(buffer)[0];
        console.log("Server sent " + data + " credits");
        app.txCredits += data;
        app.displayCredits();
        if (data === 0xFF) {
            // user is probably going to get 2 disconnect messages, which is OK for demo code
            var message = 'Server disconnected by sending -1 (0xFF) credits';
            navigator.notification.alert(message, app.showMainPage, "Disconnect");
        }
    },
    clearTextInput: function() {
        messageInput.value = "";
    },
    sendData: function(event) { // send data over bluetooth

        var success = function() {
            resultDiv.innerHTML = resultDiv.innerHTML + "Sent: " + messageInput.value + "<br/>";
            resultDiv.scrollTop = resultDiv.scrollHeight;
            app.txCredits--;
            app.displayCredits();
        };

        var failure = function(reason) {
            navigator.notification.alert(reason, {}, "Error writing data");
        };

        var data = stringToBytes(messageInput.value);
        var deviceId = event.target.dataset.deviceId;
        ble.write(deviceId, connectBlue.serviceUUID, connectBlue.txCharacteristic, data, success, failure);
    },
    sendCredits: function() {  // give the server more credits

        // This assumes there is only one connected device since it uses app.deviceId
        var credits = 10;

        var success = function() {
            console.log("Sent " + credits + " credits to the server");
            app.rxCredits += credits;
            app.displayCredits();
        };

        var failure = function(reason) {
            navigator.notification.alert(reason, {}, "Unable to send rxCredits");
        };

        var data = new Uint8Array(1);
        data[0] = credits;
        ble.write(app.deviceId, connectBlue.serviceUUID,
            connectBlue.creditsCharacteristic, data.buffer,
            success, failure);

    },
    displayCredits: function() {
        txCreditsSpan.innerHTML = app.txCredits;
        rxCreditsSpan.innerHTML = app.rxCredits;
    },
    disconnect: function(event) {
        var deviceId = event.target.dataset.deviceId;
        ble.disconnect(deviceId, app.showMainPage, app.onError);
    },
    showMainPage: function() {
        mainPage.hidden = false;
        detailPage.hidden = true;
    },
    showDetailPage: function() {
        mainPage.hidden = true;
        detailPage.hidden = false;
    },
    onError: function(reason) {
        navigator.notification.alert(reason, {}, "Error");
    }
};
