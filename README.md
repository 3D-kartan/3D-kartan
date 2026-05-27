# 3D-Kartan

A 3D map application, aimed to display 3D data in an easy to understand way. This application is built with Webpack-5 and uses Cesium JS in the background to display the globe and its content. Cesium JS is developed under the Apache-2.0 license and no modifications has been done to the core of Cesium JS.

## Set up the application

1. Clone the repo
2. CD webpack-5
3. `npm install`
4. Pre build configs:

- If you wish to use the `placement tool` you need to configure the models to be used pre build. The `placement tool` requries frontend.

- For the `searchbar` you may set the appropriate `apiBaseUrl` in `webpack.config.js`. The searchbar and the backend expects the following columns:

    - td_adress
    - td_kommund
    - Geometry (points in WGS 84)

    - schema.table setup is expected to be addresses.addresses_p

    The above parameter may be changed to fit your set-up. Future updates will move these configs to the config files for easier set-up.
    The `searchbar`Requries frontend and backend.

- The `forms tool` require the backend to be set up.

5. Run: `npm run build` and now the application is built and should be ready to be hosted.

6. Configure the `index.json` file.  

---

Important note:

If Cesium ion is gonna be used, proper attribution to Cesium ion has to be present in the model accordingly. The contribution logo needs to be set to `visible` prior to running the build - set under `src/css/main.css`.


---

```sh
npm install
npm start
# for the built version
npm run build
npm run start:built
```

Navigate to `localhost:4000`.

### Available scripts

- `npm start` - Runs a webpack build with `webpack.config.js` and starts a development server at `localhost:4000`
- `npm run build` - Runs a webpack build with `webpack.config.js`
- `npm run start:built` - Start a small static server using `http-server` to demonstrate hosting the built version

## Documentation

More documentation is being developed, check out the docs hosted here: INSERT LINK WHEN DOCS IS FINISHED.

---

Developed by Albin Näslund.
