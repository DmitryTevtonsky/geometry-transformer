import * as THREE from '../build/three.module.js';
import { OrbitControls } from './jsm/controls/OrbitControls.js';
import { TransformControls } from './jsm/controls/TransformControls.js';
import { GLTFLoader } from './jsm/loaders/GLTFLoader.js';

let container, camera, scene, renderer;
let transformControl;
let trajectoryCurve = null;
let trajectory = null;

const splineHelperObjects = [];
const prevPositions = [];
const positions = [];

const point = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const onUpPosition = new THREE.Vector2();
const onDownPosition = new THREE.Vector2();

let ARC_SEGMENTS = 0;
let SEGMENTS_MULTIPLICATOR = 10;

init();
animate();
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('handle-update-button').addEventListener('click', updateTrajectory)
});

function init() {
    container = document.getElementById('container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 10000);
    scene.add(camera);

    scene.add(new THREE.AmbientLight(0xf0f0f0));

    const planeGeometry = new THREE.PlaneGeometry(2000, 2000);
    planeGeometry.rotateX(- Math.PI / 2);
    const planeMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });

    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.position.y = 0;
    scene.add(plane);

    const helper = new THREE.GridHelper(2000, 10);
    helper.position.y = 0;
    helper.material.opacity = 0.25;
    helper.material.transparent = true;
    scene.add(helper);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    transformControl = new TransformControls(camera, renderer.domElement);
    transformControl.addEventListener('dragging-changed', function (event) {
        controls.enabled = !event.value;
    });
    transformControl.addEventListener('objectChange', () => {
        updateCurve();
    });
    scene.add(transformControl);

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointermove', onPointerMove);

    /******************* LOADER *******************/
    const loader = new GLTFLoader().setPath('models/');
    loadTrajectory(loader, controls, 'trajectory-1.gltf')
    // loadTrajectory(loader,'trajectory-2.gltf')
}

function loadTrajectory(loader, controls, file) {
    loader.load(file, function (gltf) {
        console.log('%cgltf', 'color: violet', gltf);
        gltf.scene.scale.x = 100;
        gltf.scene.scale.y = 100;
        gltf.scene.scale.z = 100;

        const [trajectoryMesh] = gltf.scene.children;
        const { geometry: { attributes: { position } } } = trajectoryMesh;

        const pointsCount = position.count;
        const pointCountInSegment = 6;
        const segmentsCount = pointsCount / pointCountInSegment;

        trajectory = gltf.scene;

        createCurve(segmentsCount * SEGMENTS_MULTIPLICATOR);
        const centroids = calcSplineObjects(position);
        console.log('%ccentroids', 'color: green', centroids);
        setCurvePoints(centroids)
        
        scene.add(gltf.scene);

        // targetting controls to trajectory
        const firstCentroid = centroids[0];
        const lastCentroid = centroids[centroids.length-1];
        const middlePoint = new THREE.Vector3().addVectors(firstCentroid, lastCentroid).divideScalar(2);
        controls.target = middlePoint;
        controls.update();
    });
}

function createCurve(pointsCount) {
    const geometry = new THREE.BufferGeometry();
    ARC_SEGMENTS = pointsCount;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointsCount * 3), 3));
    let curve = new THREE.CatmullRomCurve3(positions);
    curve.curveType = 'centripetal';
    curve.mesh = new THREE.Line(geometry.clone(), new THREE.LineBasicMaterial({
        color: 0x00ff00,
    }));
    console.log('%ccurve', 'color: gold', curve);
    const prev = new THREE.CatmullRomCurve3([])
    trajectoryCurve = curve;
    scene.add(curve.mesh);
}

function calcSplineObjects(buffer) {
    const { count: pointsCount } = buffer;
    const pointCountInSegment = 6;
    const segmentsCount = pointsCount / pointCountInSegment;

    const centroids = [];
    for (let i = 0; i < segmentsCount; i++) {
        let allX = 0;
        let allY = 0;
        let allZ = 0;
        for (let j = 0; j < pointCountInSegment; j++) {
            allX += buffer.getX(pointCountInSegment * i + j)
            allY += buffer.getY(pointCountInSegment * i + j)
            allZ += buffer.getZ(pointCountInSegment * i + j)
        }
        centroids.push(new THREE.Vector3(allX * 100 / 6, allY * 100 / 6, allZ * 100 / 6))
    }
    return centroids;
}

const curveObjectGeometry = new THREE.SphereGeometry(12, 32, 32);
function addSplineObject(position) {
    const material = new THREE.MeshLambertMaterial({ color: Math.random() * 0xffffff });
    const object = new THREE.Mesh(curveObjectGeometry, material);

    object.position.copy(position);

    scene.add(object);
    splineHelperObjects.push(object);
    return object;
}

function addCurvePoint(position) {
    positions.push(addSplineObject(position).position);
    prevPositions.push(position)
}

function updateCurve() {
    const position = trajectoryCurve.mesh.geometry.attributes.position;
    for (let i = 0; i < ARC_SEGMENTS; i++) {
        const t = i / (ARC_SEGMENTS - 1);
        trajectoryCurve.getPoint(t, point);
        position.setXYZ(i, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
}

function updateTrajectory() {
    const [trajectoryMesh] = trajectory.children;
    const trajectoryPosition = trajectoryMesh.geometry.attributes.position;
    const pointsCount = trajectoryPosition.count;
    const pointsCountInSegment = 6;
    const segmentsCount = pointsCount / pointsCountInSegment;

    // Обновляем траекторию посегментно
    for (let i = 0; i < segmentsCount; i++) {
        let x, y, z, dx, dy, dz
        const t = i / (segmentsCount - 1); // так надо))

        const point = trajectoryCurve.getPoint(t);
        const prevPoint = prevPositions[i];

        // Центройд сегмента сместился относительно предыдущей позиции на "дельту"
        dx = point.x - prevPoint.x;
        dy = point.y - prevPoint.y;
        dz = point.z - prevPoint.z;

        // Смещение точек сегментов траектории по смещению центройда
        for (let j = 0; j < pointsCountInSegment; j++) {
            x = trajectoryPosition.getX(pointsCountInSegment * i + j);
            y = trajectoryPosition.getY(pointsCountInSegment * i + j);
            z = trajectoryPosition.getZ(pointsCountInSegment * i + j);
            trajectoryPosition.setXYZ(pointsCountInSegment * i + j, x + (dx/100), y + (dy/100), z + (dz/100));
        }
        // Обновление пред.позиций
        prevPositions[i] = point;
    }
    trajectoryPosition.needsUpdate = true;
}

function setCurvePoints(new_positions) {
    for (let i = 0; i < new_positions.length; i++) {
        const position = new_positions[i]
        addCurvePoint(position);
    }
    updateCurve();
}

function animate() {
    requestAnimationFrame(animate);
    render();
}

function render() {
    renderer.render(scene, camera);
}

function onPointerDown(event) {
    onDownPosition.x = event.clientX;
    onDownPosition.y = event.clientY;
}

function onPointerUp(event) {
    onUpPosition.x = event.clientX;
    onUpPosition.y = event.clientY;

    if (onDownPosition.distanceTo(onUpPosition) === 0) transformControl.detach();
}

function onPointerMove(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = - (event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const intersects = raycaster.intersectObjects(splineHelperObjects);

    if (intersects.length > 0) {
        const object = intersects[0].object;
        if (object !== transformControl.object) {
            console.log('object', object);
            transformControl.attach(object);
        }
    }
}
