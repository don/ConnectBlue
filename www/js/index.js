// (c) 2014 Don Coleman
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
    initialize: function() {
        this.bindEvents();
        detailPage.hidden = true;
    },
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
        refreshButton.addEventListener('touchstart', this.refreshDeviceList, false);
        sendButton.addEventListener('click', this.sendData, false);
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

                // documentation lists credits as optional, but appears to be required
                // http://support.connectblue.com/display/PRODBTSPA/connectBlue+Low+Energy+Serial+Port+Service
                ble.notify(deviceId, connectBlue.serviceUUID, connectBlue.creditsCharacteristic,
                    function(buffer) { // success
                        var data = new Uint8Array(buffer)[0];
                        console.log("Server sent " + data + " credits");
                        if (data === 0xFF) {
                            var message = 'Server disconnected by sending -1 (0xFF) credits';
                            navigator.notification.alert(message, app.showMainPage, "Disconnect");
                        }
                    },
                    app.onError);

                // subscribe for incoming data, must happen after creditsCharacteristic
                ble.notify(deviceId, connectBlue.serviceUUID, connectBlue.rxCharacteristic, app.onData, app.onError);

                // send credits to the server
                var credits = new Uint8Array(1);
                credits[0] = 0x7F; // 127
                ble.write(deviceId, connectBlue.serviceUUID,
                    connectBlue.creditsCharacteristic, credits.buffer,
                    function() {
                        console.log('Sent ' + credits[0] + ' credits to server');
                    }, app.onError);

                sendButton.dataset.deviceId = deviceId;
                disconnectButton.dataset.deviceId = deviceId;
                resultDiv.innerHTML = ""; // clear old data
                app.showDetailPage();
            };

        ble.connect(deviceId, onConnect, app.onError);
    },
    onData: function(buffer) { // data received from Arduino
        var data = bytesToString(buffer);
        console.log(data);
        resultDiv.innerHTML = resultDiv.innerHTML + "Received: " + data + "<br/>";
        resultDiv.scrollTop = resultDiv.scrollHeight;
    },
    sendData: function(event) { // send data to Arduino

        var success = function() {
            console.log("success");
            resultDiv.innerHTML = resultDiv.innerHTML + "Sent: " + messageInput.value + "<br/>";
            resultDiv.scrollTop = resultDiv.scrollHeight;
        };

        var failure = function(reason) {
            navigator.notification.alert(reason, {}, "Error writing data");
        };

        var data = stringToBytes(messageInput.value);
        var deviceId = event.target.dataset.deviceId;
        ble.write(deviceId, connectBlue.serviceUUID, connectBlue.txCharacteristic, data, success, failure);
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
