var weather = require('openweather-apis');
var Request = require('superagent');
var model = require('../model/model');

weather.setLang('jp');
weather.setUnits('metric');
weather.setAPPID('be432f85fd4c709847933515dc5897fc');

const YAHOOID = 'dj00aiZpPUlkb3JBNlFnWUF0dyZzPWNvbnN1bWVyc2VjcmV0Jng9MWM-';

exports.promiseGetMetadata = (gyaonId, location) => {
  return new Promise((resolve, result) => {
    let obj = {
      weatherIconId: '',
      url: '',
      address: '',
      mapimg: ''
    };
    promiseGetWeatherIcon(location)
        .then(icon => promiseGetAddress(location)
            .then(address => promiseGetMapImg(location)
                .then(mapimg => {
                  obj.weatherIconId = icon;
                  obj.address = address;
                  obj.mapimg = mapimg;
                  resolve(obj)
                }))).catch(err => resolve(err))
  })
};

const promiseGetWeatherIcon = (location) => {
  return new Promise((resolve, result) => {
    weather.setCoordinate(location.lat, location.lon);
    weather.getAllWeather((err, JSONObj) => {
      err ? resolve(err) : resolve(JSONObj.weather[0].icon)
    });
  });
};

const promiseGetAddress = (location) => {
  return new Promise((resolve, result) => {
    Request
        .get(`https://map.yahooapis.jp/geoapi/V1/reverseGeoCoder?lat=${location.lat}&lon=${location.lon}&output=json&appid=${YAHOOID}`)
        .then(res => {
          let address = '';
          res.body.Feature[0].Property.AddressElement.forEach(element => {
            if (element.Level === "prefecture" || element.Level === "city" || element.Level === "oaza") {
              address += element.Name + ','
            }
          });
          resolve(address)
        }).catch(err => resolve(err))
  });
};

const promiseGetMapImg = (location) => {
  return new Promise((resolve, result) => {
    Request
        .get(`https://maps.googleapis.com/maps/api/staticmap?center=${location.lat},${location.lon}&zoom=15&size=300x300&maptype=roadmap
&markers=${location.lat},${location.lon}&key=AIzaSyDB5d4w7q0YomDmsrQgJepmYZpg7elDjKA`)
        .then(res => {
          Request
              .post('https://upload.gyazo.com/api/upload')
              .type('form')
              .send({
                referer_url: 'https://gyaon.herokuapp.com/',
                client_id: 'bfe375d0b3ec5c50f339ebdda59b9ff8a96298cb0fb59782d20b24fcf587cdf0',
                access_token: '00252e72bef882b4849ba9246e751f9515b461be068a9cfe02037f710c0f8192',
                image_url: 'data:image/png;base64,' + res.body.toString('base64')
              })
              .then(res => {
                resolve(res.body.url)
              })
        }).catch(err => resolve(err))
  });
};
