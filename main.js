var app = require('app');
var BrowserWindow = require('browser-window');
var Screen = require('screen');
var workAreaSize = Screen.getPrimaryDisplay().workAreaSize;
var path = require('path');
var fs = require('fs');
var dialog = require('dialog');
var ipc = require('ipc');
var Menu = require('menu');
var Tray = require('tray');

var config = require('./config');

var mainWindow = null;
var msgWindow = null;
var cfgWindow = null;

var debug = false;
for(var i=0; i<process.argv.length; i++){
    var arg = process.argv[i];
    if(arg.indexOf('--debug') == 0){
        debug = true;
        break;
    }
}

app.on('ready', function() {
    var icon = path.join(__dirname, 'assets', 'icon.png');
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 710,
        "web-preferences": {
            "web-security": false,
            "direct-write": true,
            "overlay-scrollbars": false
        },
        icon: icon
    });
    mainWindow.loadUrl('https://wx.qq.com/?lang=zh_CN');
    if(debug){
        mainWindow.toggleDevTools();    //测试：打开调试窗口
    }
    mainWindow.on('close', function(event){
        var canClose = !config.items.hideOnClose;
        if(canClose){
            return true;
        }
        if(mainWindow.isVisible()){
            mainWindow.hide();
            event.preventDefault();
        }
    });
    mainWindow.on('closed', function() {
        app.exit(); //主窗口关闭，直接退出
    });
    var showHide = function(){
        var isVisible = mainWindow.isVisible();
        if(isVisible){
            mainWindow.hide();
        }else{
            mainWindow.show();
            mainWindow.focus();
        }
    };
    //写入托盘图标
    var trayMenu = Menu.buildFromTemplate([{
            label: '显示/隐藏',
            click: showHide
        },{
            label: '设置',
            click: function(){
                if(cfgWindow){
                    cfgWindow.focus();
                    return;
                }
                cfgWindow = new BrowserWindow({
                    height: 400,
                    width: 600,
                    resizable: false,
                    icon: icon
                });
                cfgWindow.loadUrl('file://' + __dirname + '/browser/config/index.html');
                cfgWindow.on('closed', function() {
                    cfgWindow = null;   //GC
                });
                if(debug){
                    cfgWindow.openDevTools();    //测试：打开调试窗口
                }
                cfgWindow.webContents.executeJavaScript('vm.setValue('+ JSON.stringify(config.items) +')');
            }
        },{
            label: '退出',
            click: function(){
                app.exit();
            }
        }]);
    var trayIcon = new Tray(icon);
    trayIcon.setToolTip('SeiChat');
    trayIcon.setContextMenu(trayMenu);
    trayIcon.on('clicked', showHide);
    //写入初始化脚本
    var initJs = path.join(__dirname, 'browser', 'init.js');
    var web = mainWindow.webContents;
    web.on('did-finish-load', function(){
        fs.readFile(initJs, function(err, data){
            var js = data.toString();
            web.executeJavaScript(js);
        });
    });
    //监听接口
    var msgWidth = 320, msgHeight = 80;
    var closeTimeoutID = null;
    var setDelayClose = function(){
        if(closeTimeoutID){
            clearTimeout(closeTimeoutID);
        }
        if(config.items.hideTimeout <= 0){
            return false;
        }
        closeTimeoutID = setTimeout(function(){
            if(msgWindow){
                msgWindow.close();
            }
        }, config.items.hideTimeout);
    }
    ipc.on('new-message', function(event, arg){
        if(arg.isSend || !arg.unread){
            return;
        }
        //检查配置
        var canShow = config.items.tipWinCondition == 'always' || (config.items.tipWinCondition == 'auto' && !mainWindow.isVisible());
        if(!canShow){
            return;
        }
        //检查是否已经有了消息接口
        if(closeTimeoutID){
            clearTimeout(closeTimeoutID);
        }
        if(msgWindow){
            var size = msgWindow.getSize();
            msgWindow.setSize(size[0], size[1] + msgHeight);
            var pos = msgWindow.getPosition();
            msgWindow.setPosition(pos[0], pos[1] - msgHeight);
            msgWindow.webContents.executeJavaScript("vm.$data.messages.push("+JSON.stringify(arg)+");");
        }else{
            //创建消息窗口
            msgWindow = new BrowserWindow({
                x: workAreaSize.width - msgWidth,
                y: workAreaSize.height - msgHeight,
                height: msgHeight,
                width: msgWidth,
                resizable: false,
                'always-on-top': true,
                'skip-taskbar': true,
                frame: false,
                icon: icon
            });
            //不给焦点
            msgWindow.blurWebView();
            msgWindow.loadUrl('file://' + __dirname + '/browser/tip/index.html');
            setTimeout(function(){
                msgWindow.webContents.executeJavaScript("vm.$data.messages.push("+JSON.stringify(arg)+");");
            }, 100);
            msgWindow.on('closed', function() {
                msgWindow = null;   //GC
                closeTimeoutID = null;
            });
        }
        setDelayClose();
    });
    ipc.on('message-close', function(event, remainMessages){
        if(remainMessages == 0){
            if(msgWindow){
                msgWindow.close();
            }
        }else{
            var size = msgWindow.getSize();
            msgWindow.setSize(size[0], size[1] - msgHeight);
            var pos = msgWindow.getPosition();
            msgWindow.setPosition(pos[0], pos[1] + msgHeight);
        }
    });
    ipc.on('message-delay', function(){
        setDelayClose();
    });
    ipc.on('message-do-not-close', function(){
        clearTimeout(closeTimeoutID);
    });
    ipc.on('close-config-window', function(event){
        cfgWindow.close();
    });
    ipc.on('save-config', function(event, data){
        config.save(data);
    });
    ipc.on('call-webmm', function(event, data){
        //执行WebMM的逻辑js
        //data:{
        //  call: 'logic',
        //  sub: 'sendMsg',
        //  method: 'sendText'
        //  data: {
        //      Msg: {
        //          FromUserName: "",
        //          ToUserName: "",
        //          Type: 1,
        //          Content: "the quick brown fox jumps over the lazy dog"
        //      }
        //  }
        //}
        mainWindow.webContents.executeJavaScript("WebMM." + data.call + 
            "('" + data.sub + "')." + data.method + "(" +
            JSON.stringify(data.data) + ",{});"
        );
    });
});